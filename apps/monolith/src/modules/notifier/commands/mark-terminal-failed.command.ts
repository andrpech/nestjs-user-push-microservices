import { Inject, Injectable } from '@nestjs/common'

import { Command } from '@app/common'
import { NotificationsWritePrismaClient } from '../../../database/notifications.clients'

export interface MarkTerminalFailedInput {
	notificationId: string
	error: string
}

@Injectable()
export class MarkTerminalFailedCommand implements Command<MarkTerminalFailedInput, void> {
	constructor(
		@Inject(NotificationsWritePrismaClient)
		private readonly write: NotificationsWritePrismaClient
	) {}

	async execute({ notificationId, error }: MarkTerminalFailedInput): Promise<void> {
		await this.write.$executeRawUnsafe(
			`UPDATE notifications
			 SET status = 'FAILED',
			     last_error = $1,
			     processing_started_at = NULL
			 WHERE id = $2`,
			error,
			notificationId
		)
	}
}
