import { Inject, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { ZodType } from 'zod'

import { Consumer, ConsumerCtx, RmqConnection, RmqConsumer } from '@app/rmq'
import { ConfigurationInjectKey, ConfigurationType } from '../../../config'
import { NotificationsReadPrismaClient } from '../../../database/notifications.clients'
import { MarkAttemptFailedCommand } from '../commands/mark-attempt-failed.command'
import { MarkSentCommand } from '../commands/mark-sent.command'
import { MarkTerminalFailedCommand } from '../commands/mark-terminal-failed.command'
import { SendPushCommand } from '../commands/send-push.command'
import { PushSendEvent, PushSendEventSchema } from '../dto/push-send.event'
import { PushSendRetryProducer } from '../producers/push-send-retry.producer'

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
		@Inject(NotificationsReadPrismaClient)
		private readonly read: NotificationsReadPrismaClient,
		@Inject(ConfigurationInjectKey)
		private readonly config: ConfigurationType,
		private readonly sendPush: SendPushCommand,
		private readonly markSent: MarkSentCommand,
		private readonly markAttemptFailed: MarkAttemptFailedCommand,
		private readonly markTerminalFailed: MarkTerminalFailedCommand,
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
			userId: event.userId,
			notificationId: event.notificationId
		}

		const row = await this.read.notification.findUnique({
			where: { id: event.notificationId }
		})

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

		const result = await this.sendPush.execute({
			notificationId: event.notificationId,
			userId: event.userId,
			name: event.name
		})

		if (result.ok) {
			await this.markSent.execute(event.notificationId)
			this.pinoLogger.info({ ...baseLog, status: result.status }, 'push sent')
			return
		}

		const errorDetail = result.error
		const { attempts } = await this.markAttemptFailed.execute({
			notificationId: event.notificationId,
			error: errorDetail
		})

		const { maxAttempts } = this.config.push
		if (attempts >= maxAttempts) {
			await this.markTerminalFailed.execute({
				notificationId: event.notificationId,
				error: errorDetail
			})
			this.pinoLogger.warn(
				{ ...baseLog, attempts, error: errorDetail },
				'push exhausted retries — terminal FAILED'
			)
			return
		}

		const expirationMs = 1000 * 2 ** (attempts - 1)
		await this.retryProducer.publish(event, {
			expiration: expirationMs,
			messageId: event.notificationId
		})
		this.pinoLogger.info(
			{ ...baseLog, attempts, expirationMs, error: errorDetail },
			'push attempt failed — scheduled retry'
		)
	}
}
