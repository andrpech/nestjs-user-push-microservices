import { Inject, Injectable } from '@nestjs/common'

import { Command } from '@app/common'
import { Notification } from '../../../../prisma/generated'
import { NotificationsWritePrismaClient } from '../../../database/notifications.clients'
import { historyEntry, historyJson } from '../../notifier/history'

export type RetryOutcome =
	| { kind: 'retried'; row: Notification }
	| { kind: 'wrong_status'; currentStatus: string }
	| { kind: 'not_found' }

@Injectable()
export class RetryNotificationCommand implements Command<string, RetryOutcome> {
	constructor(
		@Inject(NotificationsWritePrismaClient)
		private readonly write: NotificationsWritePrismaClient
	) {}

	async execute(notificationId: string): Promise<RetryOutcome> {
		// Single conditional UPDATE returns the new row when the FAILED → PENDING
		// transition fires, nothing otherwise. A follow-up SELECT distinguishes
		// "wrong status" (row exists but status≠FAILED) from "not found".
		const segment = historyJson(historyEntry('MANUAL_RETRY'))
		const updated = await this.write.$queryRawUnsafe<Notification[]>(
			`UPDATE notifications
			 SET status = 'PENDING',
			     attempts = 0,
			     processing_started_at = NULL,
			     last_error = NULL,
			     history = history || $1::jsonb,
			     updated_at = NOW()
			 WHERE id = $2 AND status = 'FAILED'
			 RETURNING *`,
			segment,
			notificationId
		)

		if (updated[0]) return { kind: 'retried', row: updated[0] }

		const existing = await this.write.notification.findUnique({
			where: { id: notificationId },
			select: { status: true }
		})
		if (!existing) return { kind: 'not_found' }
		return { kind: 'wrong_status', currentStatus: existing.status }
	}
}
