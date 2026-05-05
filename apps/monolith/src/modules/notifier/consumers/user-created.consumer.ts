import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { ZodType } from 'zod'

import { Consumer, ConsumerCtx, RmqConnection, RmqConsumer } from '@app/rmq'
import { CreateNotificationCommand } from '../commands/create-notification.command'
import { UserCreatedEvent, UserCreatedEventSchema } from '../dto/user-created.event'

const QUEUE = 'notifier.user-created'

@Injectable()
@Consumer({
	queue: QUEUE,
	prefetch: 10,
	bindings: [
		{
			exchange: 'users.events',
			routingKey: 'user.created',
			exchangeType: 'topic'
		}
	]
})
export class UserCreatedConsumer extends RmqConsumer<UserCreatedEvent> {
	protected readonly schema: ZodType<UserCreatedEvent> = UserCreatedEventSchema

	constructor(
		conn: RmqConnection,
		private readonly createNotification: CreateNotificationCommand,
		private readonly pinoLogger: PinoLogger
	) {
		super(conn)
		this.pinoLogger.setContext(UserCreatedConsumer.name)
	}

	async handle(event: UserCreatedEvent, ctx: ConsumerCtx): Promise<void> {
		const result = await this.createNotification.execute({
			userId: event.userId,
			name: event.name
		})

		this.pinoLogger.info(
			{
				messageId: ctx.messageId,
				queue: QUEUE,
				userId: event.userId,
				notificationId: result.notificationId,
				deduped: result.deduped
			},
			'notification ingested'
		)
	}
}
