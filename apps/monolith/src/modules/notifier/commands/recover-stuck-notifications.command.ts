import { Inject, Injectable } from '@nestjs/common'

import { Command } from '@app/common'
import { ConfigurationInjectKey, ConfigurationType } from '../../../config'
import { NotificationsWritePrismaClient } from '../../../database/notifications.clients'
import { historyEntry, historyJson } from '../history'

@Injectable()
export class RecoverStuckNotificationsCommand implements Command<void, number> {
	constructor(
		@Inject(NotificationsWritePrismaClient)
		private readonly write: NotificationsWritePrismaClient,
		@Inject(ConfigurationInjectKey)
		private readonly config: ConfigurationType
	) {}

	// Phase 5: reset stuck PROCESSING rows back to PENDING and bump redrive_count.
	// Phase 6 will add the MAX_REDRIVES cap that transitions to FAILED instead.
	async execute(): Promise<number> {
		const { recoveryThresholdMs } = this.config.notifier
		const segment = historyJson(historyEntry('REDRIVEN_FROM_STUCK'))

		const result = await this.write.$executeRawUnsafe<number>(
			`UPDATE notifications
			 SET status = 'PENDING',
			     processing_started_at = NULL,
			     redrive_count = redrive_count + 1,
			     last_redriven_at = NOW(),
			     history = history || $1::jsonb
			 WHERE status = 'PROCESSING'
			   AND processing_started_at < NOW() - ($2::int * INTERVAL '1 millisecond')`,
			segment,
			recoveryThresholdMs
		)
		return Number(result)
	}
}
