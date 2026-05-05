import { Inject, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { Command } from '@app/common'
import { ConfigurationInjectKey, ConfigurationType } from '../../../config'
import { UsersWritePrismaClient } from '../../../database/users.clients'
import { UserCreatedProducer } from '../producers/user-created.producer'

type ClaimedRow = {
	id: string
	name: string
}

export type ClaimAndPublishOutput = {
	swept: number
	claimed: number
	published: number
	failed: number
}

@Injectable()
export class ClaimAndPublishUsersCommand implements Command<void, ClaimAndPublishOutput> {
	constructor(
		@Inject(UsersWritePrismaClient)
		private readonly write: UsersWritePrismaClient,
		@Inject(ConfigurationInjectKey)
		private readonly config: ConfigurationType,
		private readonly producer: UserCreatedProducer,
		private readonly logger: PinoLogger
	) {
		this.logger.setContext(ClaimAndPublishUsersCommand.name)
	}

	async execute(): Promise<ClaimAndPublishOutput> {
		const swept = await this.sweepStuck()
		const claimed = await this.claimBatch()

		const results = await Promise.all(claimed.map((row) => this.publishOne(row)))
		const published = results.filter((ok) => ok).length
		const failed = results.length - published

		if (swept > 0 || claimed.length > 0) {
			this.logger.info({ swept, claimed: claimed.length, published, failed }, 'outbox tick')
		}

		return { swept, claimed: claimed.length, published, failed }
	}

	private async publishOne(row: ClaimedRow): Promise<boolean> {
		try {
			await this.producer.publish({ userId: row.id, name: row.name })
			await this.markPublished(row.id)
			return true
		} catch (error) {
			this.logger.error({ err: error, userId: row.id }, 'outbox publish failed; row stays claimed')
			return false
		}
	}

	private async sweepStuck(): Promise<number> {
		const thresholdMs = this.config.outbox.stuckThresholdMs
		const result = await this.write.$executeRawUnsafe<number>(
			`UPDATE users
			 SET publishing_started_at = NULL
			 WHERE published_at IS NULL
			   AND publishing_started_at IS NOT NULL
			   AND publishing_started_at < NOW() - ($1::int * INTERVAL '1 millisecond')`,
			thresholdMs
		)
		return Number(result)
	}

	private claimBatch(): Promise<ClaimedRow[]> {
		const { batchSize } = this.config.outbox
		return this.write.$queryRawUnsafe<ClaimedRow[]>(
			`WITH eligible AS (
				SELECT id FROM users
				WHERE published_at IS NULL AND publishing_started_at IS NULL
				ORDER BY created_at ASC
				LIMIT $1
				FOR UPDATE SKIP LOCKED
			)
			UPDATE users
			SET publishing_started_at = NOW()
			WHERE id IN (SELECT id FROM eligible)
			RETURNING id, name`,
			batchSize
		)
	}

	private async markPublished(userId: string): Promise<void> {
		await this.write.$executeRawUnsafe(
			`UPDATE users
			 SET published_at = NOW(), publishing_started_at = NULL
			 WHERE id = $1`,
			userId
		)
	}
}
