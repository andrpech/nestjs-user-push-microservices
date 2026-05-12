import { Inject, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { ZodType } from 'zod'

import { Consumer, ConsumerCtx, RmqConnection, RmqConsumer } from '@app/rmq'
import { RecordSendAttemptCommand } from '../commands/record-send-attempt.command'
import { PushSendEvent, PushSendEventSchema } from '../dto/push-send.event'
import { PushSendRetryProducer } from '../producers/push-send-retry.producer'
import { NotificationsRepository } from '../repositories/notifications.repository'
import { WebhookTransport } from '../transport/webhook.transport'
import { computeBackoffMs, TYPE_CATALOG_TOKEN, TypeCatalog } from '../type-catalog/type-catalog'

const QUEUE = 'notifier.push-send'

@Injectable()
@Consumer({
	queue: QUEUE,
	prefetch: 10,
	bindings: [
		{
			exchange: 'notifications.work',
			routingKey: 'push.send',
			exchangeType: 'topic'
		}
	]
})
export class PushSendConsumer extends RmqConsumer<PushSendEvent> {
	protected readonly schema: ZodType<PushSendEvent> = PushSendEventSchema

	constructor(
		conn: RmqConnection,
		private readonly repo: NotificationsRepository,
		@Inject(TYPE_CATALOG_TOKEN)
		private readonly catalog: TypeCatalog,
		private readonly transport: WebhookTransport,
		private readonly recordSendAttempt: RecordSendAttemptCommand,
		private readonly retryProducer: PushSendRetryProducer,
		private readonly pinoLogger: PinoLogger
	) {
		super(conn)
		this.pinoLogger.setContext(PushSendConsumer.name)
	}

	async handle(event: PushSendEvent, ctx: ConsumerCtx): Promise<void> {
		const baseLog = {
			messageId: ctx.messageId,
			queue: QUEUE,
			notificationId: event.notificationId
		}

		const row = await this.repo.findById(event.notificationId)
		if (!row) {
			this.pinoLogger.warn(baseLog, 'notification missing — ack and skip')
			return
		}

		if (row.status === 'SENT' || row.status === 'FAILED') {
			this.pinoLogger.info({ ...baseLog, status: row.status }, 'already terminal — ack and skip')
			return
		}

		if (row.status !== 'PROCESSING') {
			this.pinoLogger.warn({ ...baseLog, status: row.status }, 'unexpected status — ack and skip')
			return
		}

		const entry = this.catalog.entryFor(row.type)
		if (!entry) {
			throw new Error(`unknown notification type for stored row: ${row.type}`)
		}

		const params = entry.paramsSchema.parse(row.params)
		const { body } = entry.render(params)

		const result = await this.transport.send({
			notificationId: row.id,
			body
		})

		const verdict = await this.recordSendAttempt.execute({
			notificationId: row.id,
			outcome: result.ok ? { ok: true } : { ok: false, error: result.error },
			maxAttempts: entry.retryPolicy.maxAttempts
		})

		if (verdict.kind === 'sent') {
			this.pinoLogger.info(
				{ ...baseLog, status: result.ok ? result.status : undefined },
				'push sent'
			)
			return
		}

		if (verdict.kind === 'terminal-failed') {
			const errorMsg = result.ok ? undefined : result.error
			this.pinoLogger.warn(
				{ ...baseLog, error: errorMsg },
				'push exhausted retries — terminal FAILED'
			)
			return
		}

		const errorMsg = result.ok ? '' : result.error
		const backoffMs = computeBackoffMs(entry.retryPolicy, verdict.attempts)
		await this.retryProducer.publish(
			{ notificationId: row.id },
			{ expiration: backoffMs, messageId: row.id }
		)
		this.pinoLogger.info(
			{ ...baseLog, attempts: verdict.attempts, backoffMs, error: errorMsg },
			'push attempt failed — scheduled retry'
		)
	}
}
