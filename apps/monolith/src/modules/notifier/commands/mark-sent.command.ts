import { Inject, Injectable } from '@nestjs/common'

import { Command } from '@app/common'
import { NotificationsWritePrismaClient } from '../../../database/notifications.clients'
import { historyEntry, historyJson } from '../history'

@Injectable()
export class MarkSentCommand implements Command<string, void> {
	constructor(
		@Inject(NotificationsWritePrismaClient)
		private readonly write: NotificationsWritePrismaClient
	) {}

	async execute(notificationId: string): Promise<void> {
		const segment = historyJson(historyEntry('PUSH_SENT'))
		await this.write.$executeRawUnsafe(
			`UPDATE notifications
			 SET status = 'SENT',
			     sent_at = NOW(),
			     history = history || $1::jsonb
			 WHERE id = $2`,
			segment,
			notificationId
		)
	}
}
