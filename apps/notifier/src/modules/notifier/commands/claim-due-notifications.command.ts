import { Inject, Injectable } from '@nestjs/common'

import { Command } from '@app/common'
import { ConfigurationInjectKey, ConfigurationType } from '../../../config'
import { NotificationsWritePrismaClient } from '../../../database/notifications.clients'
import { historyEntry, historyJson } from '../history'

export type ClaimedNotification = {
	id: string
	userId: string
	name: string
}

@Injectable()
export class ClaimDueNotificationsCommand implements Command<void, ClaimedNotification[]> {
	constructor(
		@Inject(NotificationsWritePrismaClient)
		private readonly write: NotificationsWritePrismaClient,
		@Inject(ConfigurationInjectKey)
		private readonly config: ConfigurationType
	) {}

	execute(): Promise<ClaimedNotification[]> {
		const { batchSize, notificationDelayMs } = this.config.notifier
		const segment = historyJson(historyEntry('CLAIMED_BY_TICK'))

		return this.write.$queryRawUnsafe<ClaimedNotification[]>(
			`WITH due AS (
				SELECT id FROM notifications
				WHERE status = 'PENDING'
				  AND created_at + ($1::int * INTERVAL '1 millisecond') < NOW()
				ORDER BY created_at ASC
				LIMIT $2
				FOR UPDATE SKIP LOCKED
			)
			UPDATE notifications
			SET status = 'PROCESSING',
			    processing_started_at = NOW(),
			    history = history || $3::jsonb
			WHERE id IN (SELECT id FROM due)
			RETURNING id, user_id AS "userId", name`,
			notificationDelayMs,
			batchSize,
			segment
		)
	}
}
