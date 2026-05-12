import { Inject, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { ZodType } from 'zod'

import { Consumer, ConsumerCtx, RmqConnection, RmqConsumer } from '@app/rmq'
import { Prisma } from '../../../../prisma/generated'
import { IngestEvent, IngestEventSchema } from '../dto/ingest.event'
import { NotificationStateMachine } from '../state-machine/notification.state-machine'
import { TYPE_CATALOG_TOKEN, TypeCatalog } from '../type-catalog/type-catalog'

const QUEUE = 'notifier.ingest'

// Single consumer for every notification type. The TypeCatalog tells us per-type
// how to validate params, what channel to use, and what default delay applies.
// Unknown type or param-schema failure routes to the inbox DLX via the base
// class's nack path.
@Injectable()
@Consumer({
	queue: QUEUE,
	prefetch: 10,
	queueArgs: {
		'x-dead-letter-exchange': 'notifications.retry.events'
	},
	bindings: [
		{
			exchange: 'notifications.ingest',
			routingKey: 'ingest.#',
			exchangeType: 'topic'
		}
	],
	dlq: {
		exchange: 'notifications.dlx',
		routingKey: 'ingest',
		maxAttempts: 5
	}
})
export class IngestConsumer extends RmqConsumer<IngestEvent> {
	protected readonly schema: ZodType<IngestEvent> = IngestEventSchema

	constructor(
		conn: RmqConnection,
		@Inject(TYPE_CATALOG_TOKEN)
		private readonly catalog: TypeCatalog,
		private readonly stateMachine: NotificationStateMachine,
		private readonly pinoLogger: PinoLogger
	) {
		super(conn)
		this.pinoLogger.setContext(IngestConsumer.name)
	}

	async handle(event: IngestEvent, ctx: ConsumerCtx): Promise<void> {
		const entry = this.catalog.entryFor(event.type)
		if (!entry) {
			throw new Error(`unknown notification type: ${event.type}`)
		}

		const params = entry.paramsSchema.parse(event.params)

		const scheduledFor = event.scheduledFor
			? new Date(event.scheduledFor)
			: new Date(Date.now() + entry.defaultDelayMs)

		const result = await this.stateMachine.ingest({
			type: event.type,
			sourceEventId: event.sourceEventId,
			channel: entry.channel,
			recipient: event.recipient as unknown as Prisma.InputJsonValue,
			params: params as unknown as Prisma.InputJsonValue,
			scheduledFor
		})

		this.pinoLogger.info(
			{
				messageId: ctx.messageId,
				queue: QUEUE,
				type: event.type,
				sourceEventId: event.sourceEventId,
				notificationId: result.notificationId,
				deduped: result.deduped,
				deathCount: ctx.deathCount
			},
			'notification ingested'
		)
	}
}
