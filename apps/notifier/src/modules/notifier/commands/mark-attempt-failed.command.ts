import { Inject, Injectable } from '@nestjs/common'

import { Command } from '@app/common'
import { NotificationsWritePrismaClient } from '../../../database/notifications.clients'

export interface MarkAttemptFailedInput {
	notificationId: string
	error: string
}

export interface MarkAttemptFailedOutput {
	attempts: number
}

// Atomic increment + last_error update. PUSH_ATTEMPT history is appended
// inside SendPushCommand on every HTTP attempt — this command only handles
// the bookkeeping side.
@Injectable()
export class MarkAttemptFailedCommand implements Command<
	MarkAttemptFailedInput,
	MarkAttemptFailedOutput
> {
	constructor(
		@Inject(NotificationsWritePrismaClient)
		private readonly write: NotificationsWritePrismaClient
	) {}

	async execute({
		notificationId,
		error
	}: MarkAttemptFailedInput): Promise<MarkAttemptFailedOutput> {
		const rows = await this.write.$queryRawUnsafe<{ attempts: number }[]>(
			`UPDATE notifications
			 SET attempts = attempts + 1,
			     last_error = $1
			 WHERE id = $2
			 RETURNING attempts`,
			error,
			notificationId
		)
		return { attempts: rows[0]?.attempts ?? 0 }
	}
}
