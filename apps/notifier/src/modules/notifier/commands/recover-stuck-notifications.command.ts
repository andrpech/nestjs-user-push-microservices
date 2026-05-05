import { Inject, Injectable } from '@nestjs/common'

import { Command } from '@app/common'
import { ConfigurationInjectKey, ConfigurationType } from '../../../config'
import { NotificationsWritePrismaClient } from '../../../database/notifications.clients'
import { historyEntry, historyJson } from '../history'

export type RecoverStuckOutput = {
	recovered: number
	failed: number
}

@Injectable()
export class RecoverStuckNotificationsCommand implements Command<void, RecoverStuckOutput> {
	constructor(
		@Inject(NotificationsWritePrismaClient)
		private readonly write: NotificationsWritePrismaClient,
		@Inject(ConfigurationInjectKey)
		private readonly config: ConfigurationType
	) {}

	async execute(): Promise<RecoverStuckOutput> {
		const { recoveryThresholdMs } = this.config.notifier
		const { maxRedrives } = this.config.retry

		// First: rows past the redrive cap → terminal FAILED.
		const failedSegment = historyJson(
			historyEntry('REDRIVEN_FROM_STUCK', { error: 'exceeded redrive limit' })
		)
		const failedResult = await this.write.$executeRawUnsafe<number>(
			`UPDATE notifications
			 SET status = 'FAILED',
			     last_error = 'exceeded redrive limit',
			     processing_started_at = NULL,
			     history = history || $1::jsonb
			 WHERE status = 'PROCESSING'
			   AND processing_started_at < NOW() - ($2::int * INTERVAL '1 millisecond')
			   AND redrive_count >= $3`,
			failedSegment,
			recoveryThresholdMs,
			maxRedrives
		)

		// Then: eligible rows → reset to PENDING + bump redrive count.
		const recoverSegment = historyJson(historyEntry('REDRIVEN_FROM_STUCK'))
		const recoveredResult = await this.write.$executeRawUnsafe<number>(
			`UPDATE notifications
			 SET status = 'PENDING',
			     processing_started_at = NULL,
			     redrive_count = redrive_count + 1,
			     last_redriven_at = NOW(),
			     history = history || $1::jsonb
			 WHERE status = 'PROCESSING'
			   AND processing_started_at < NOW() - ($2::int * INTERVAL '1 millisecond')
			   AND redrive_count < $3`,
			recoverSegment,
			recoveryThresholdMs,
			maxRedrives
		)

		return { recovered: Number(recoveredResult), failed: Number(failedResult) }
	}
}
