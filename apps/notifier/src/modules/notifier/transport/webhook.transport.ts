import { Inject, Injectable } from '@nestjs/common'

import { ConfigurationInjectKey, ConfigurationType } from '../../../config'

const APP_NAME = 'nestjs-user-push-microservices'
const APP_VERSION = '0.1.0'
const USER_AGENT = `${APP_NAME}/${APP_VERSION}`

export interface WebhookEnvelope {
	notificationId: string
	body: Record<string, unknown>
}

export type TransportResult =
	| { ok: true; status: number }
	| { ok: false; status?: number; error: string }

// Phase 1: single concrete transport, no interface or decorators yet. Phase 2
// extracts NotificationTransport interface and wraps this in rate-limit and
// circuit-breaker decorators.
@Injectable()
export class WebhookTransport {
	constructor(
		@Inject(ConfigurationInjectKey)
		private readonly config: ConfigurationType
	) {}

	async send(envelope: WebhookEnvelope): Promise<TransportResult> {
		const { webhookUrl, httpTimeoutMs } = this.config.push
		try {
			const response = await fetch(webhookUrl, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Idempotency-Key': envelope.notificationId,
					'User-Agent': USER_AGENT
				},
				body: JSON.stringify(envelope.body),
				signal: AbortSignal.timeout(httpTimeoutMs)
			})
			if (response.status >= 200 && response.status < 300) {
				return { ok: true, status: response.status }
			}
			return {
				ok: false,
				status: response.status,
				error: `webhook returned ${response.status}`
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			return { ok: false, error: message }
		}
	}
}
