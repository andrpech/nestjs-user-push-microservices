import { Inject, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { Command } from '@app/common'
import { ConfigurationInjectKey, ConfigurationType } from '../../../config'
import type { IngestEvent } from '../dto/ingest.event'
import { IngestProducer } from '../producers/ingest.producer'
import { ClaimedOutboxRow, UsersOutboxRepository } from '../repositories/users-outbox.repository'

export type ClaimAndPublishOutput = {
	swept: number
	claimed: number
	published: number
	failed: number
}

const routingKeyFor = (type: string): string => `ingest.${type.toLowerCase().replace(/_/g, '-')}`

@Injectable()
export class ClaimAndPublishUsersCommand implements Command<void, ClaimAndPublishOutput> {
	constructor(
		@Inject(ConfigurationInjectKey)
		private readonly config: ConfigurationType,
		private readonly outbox: UsersOutboxRepository,
		private readonly producer: IngestProducer,
		private readonly logger: PinoLogger
	) {
		this.logger.setContext(ClaimAndPublishUsersCommand.name)
	}

	async execute(): Promise<ClaimAndPublishOutput> {
		const swept = await this.outbox.sweepStuck(this.config.outbox.stuckThresholdMs)
		const claimed = await this.outbox.claimBatch(this.config.outbox.batchSize)

		const results = await Promise.all(claimed.map((row) => this.publishOne(row)))
		const published = results.filter((ok) => ok).length
		const failed = results.length - published

		if (swept > 0 || claimed.length > 0) {
			this.logger.info({ swept, claimed: claimed.length, published, failed }, 'outbox tick')
		}

		return { swept, claimed: claimed.length, published, failed }
	}

	private async publishOne(row: ClaimedOutboxRow): Promise<boolean> {
		try {
			const event = row.payload as IngestEvent
			await this.producer.publish(event, {
				messageId: row.sourceEventId,
				routingKey: routingKeyFor(event.type)
			})
			await this.outbox.markPublished(row.id)
			return true
		} catch (error) {
			this.logger.error(
				{ err: error, outboxId: row.id },
				'outbox publish failed; row stays claimed'
			)
			return false
		}
	}
}
