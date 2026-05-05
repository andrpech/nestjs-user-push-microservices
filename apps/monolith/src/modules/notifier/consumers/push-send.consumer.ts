import { Inject, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { ZodType } from 'zod'

import { Consumer, ConsumerCtx, RmqConnection, RmqConsumer } from '@app/rmq'
import { NotificationsReadPrismaClient } from '../../../database/notifications.clients'
import { MarkSentCommand } from '../commands/mark-sent.command'
import { SendPushCommand } from '../commands/send-push.command'
import { PushSendEvent, PushSendEventSchema } from '../dto/push-send.event'

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
		private readonly sendPush: SendPushCommand,
		private readonly markSent: MarkSentCommand,
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

		// Phase 5 — log only on failure. Phase 6 will republish to retry queue.
		this.pinoLogger.warn(
			{ ...baseLog, status: result.status, error: result.error },
			'push attempt failed — leaving row PROCESSING for stuck recovery'
		)
	}
}
