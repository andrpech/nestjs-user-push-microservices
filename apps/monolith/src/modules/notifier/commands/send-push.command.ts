import { Inject, Injectable } from '@nestjs/common'

import { Command } from '@app/common'
import { ConfigurationInjectKey, ConfigurationType } from '../../../config'
import { NotificationsWritePrismaClient } from '../../../database/notifications.clients'
import { historyEntry, historyJson } from '../history'

const APP_NAME = 'nestjs-user-push-microservices'
const APP_VERSION = '0.1.0'
const USER_AGENT = `${APP_NAME}/${APP_VERSION}`

export interface SendPushInput {
	notificationId: string
	userId: string
	name: string
}

export type SendPushResult =
	| { ok: true; status: number }
	| { ok: false; status?: number; error: string }

@Injectable()
export class SendPushCommand implements Command<SendPushInput, SendPushResult> {
	constructor(
		@Inject(NotificationsWritePrismaClient)
		private readonly write: NotificationsWritePrismaClient,
		@Inject(ConfigurationInjectKey)
		private readonly config: ConfigurationType
	) {}

	async execute(input: SendPushInput): Promise<SendPushResult> {
		const { webhookUrl, httpTimeoutMs } = this.config.push
		const body = JSON.stringify({
			userId: input.userId,
			name: input.name,
			notificationId: input.notificationId
		})

		try {
			const response = await fetch(webhookUrl, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Idempotency-Key': input.notificationId,
					'User-Agent': USER_AGENT
				},
				body,
				signal: AbortSignal.timeout(httpTimeoutMs)
			})

			await this.appendAttempt(input.notificationId, { status: response.status })

			if (response.status >= 200 && response.status < 300) {
				return { ok: true, status: response.status }
			}
			return { ok: false, status: response.status, error: `webhook returned ${response.status}` }
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			await this.appendAttempt(input.notificationId, { error: message })
			return { ok: false, error: message }
		}
	}

	private async appendAttempt(
		notificationId: string,
		attempt: { status?: number; error?: string }
	): Promise<void> {
		const segment = historyJson(historyEntry('PUSH_ATTEMPT', attempt))
		await this.write.$executeRawUnsafe(
			`UPDATE notifications SET history = history || $1::jsonb WHERE id = $2`,
			segment,
			notificationId
		)
	}
}
