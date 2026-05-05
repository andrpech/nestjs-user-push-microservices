import { Inject, Injectable } from '@nestjs/common'

import { Command } from '@app/common'
import { MetricsService } from '@app/metrics'
import { NotificationsWritePrismaClient } from '../../../database/notifications.clients'

export interface MarkTerminalFailedInput {
	notificationId: string
	error: string
	reason?: 'webhook_failure' | 'exceeded_redrive_limit'
}

@Injectable()
export class MarkTerminalFailedCommand implements Command<MarkTerminalFailedInput, void> {
	constructor(
		@Inject(NotificationsWritePrismaClient)
		private readonly write: NotificationsWritePrismaClient,
		private readonly metrics: MetricsService
	) {}

	async execute({ notificationId, error, reason }: MarkTerminalFailedInput): Promise<void> {
		const rows = await this.write.$queryRawUnsafe<{ redrive_count: number }[]>(
			`UPDATE notifications
			 SET status = 'FAILED',
			     last_error = $1,
			     processing_started_at = NULL
			 WHERE id = $2
			 RETURNING redrive_count`,
			error,
			notificationId
		)

		this.metrics.notificationsFailedTotal.labels({ reason: reason ?? 'webhook_failure' }).inc()

		if (rows[0]) {
			this.metrics.notificationRedriveCount.observe(rows[0].redrive_count)
		}
	}
}
