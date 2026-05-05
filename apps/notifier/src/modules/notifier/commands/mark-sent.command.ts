import { Inject, Injectable } from '@nestjs/common'

import { Command } from '@app/common'
import { MetricsService } from '@app/metrics'
import { NotificationsWritePrismaClient } from '../../../database/notifications.clients'
import { historyEntry, historyJson } from '../history'

@Injectable()
export class MarkSentCommand implements Command<string, void> {
	constructor(
		@Inject(NotificationsWritePrismaClient)
		private readonly write: NotificationsWritePrismaClient,
		private readonly metrics: MetricsService
	) {}

	async execute(notificationId: string): Promise<void> {
		const segment = historyJson(historyEntry('PUSH_SENT'))
		const rows = await this.write.$queryRawUnsafe<{ redrive_count: number }[]>(
			`UPDATE notifications
			 SET status = 'SENT',
			     sent_at = NOW(),
			     history = history || $1::jsonb
			 WHERE id = $2
			 RETURNING redrive_count`,
			segment,
			notificationId
		)

		this.metrics.notificationsSentTotal.inc()

		if (rows[0]) {
			this.metrics.notificationRedriveCount.observe(rows[0].redrive_count)
		}
	}
}
