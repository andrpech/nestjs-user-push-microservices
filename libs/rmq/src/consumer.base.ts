import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import type { ChannelWrapper } from 'amqp-connection-manager'
import type { Channel, ConsumeMessage, Message } from 'amqplib'
import { ZodType } from 'zod'

import { ConsumerDlq, getConsumerMetadata } from './decorators/consumer.decorator'
import { RmqConnection } from './rmq-connection'
import type { ConsumerCtx } from './types'

@Injectable()
export abstract class RmqConsumer<T> implements OnModuleInit {
	protected readonly logger: Logger = new Logger(this.constructor.name)
	protected abstract readonly schema: ZodType<T>
	protected channel: ChannelWrapper | undefined

	constructor(protected readonly conn: RmqConnection) {}

	abstract handle(payload: T, ctx: ConsumerCtx): Promise<void>

	async onModuleInit(): Promise<void> {
		const meta = getConsumerMetadata(this)
		if (!meta) {
			throw new Error(`@Consumer({...}) decorator missing on ${this.constructor.name}`)
		}

		const { queue, prefetch = 10, bindings = [], queueArgs } = meta
		this.channel = this.conn.createChannel()

		await this.channel.addSetup(async (ch: Channel) => {
			await Promise.all(
				bindings.map((b) =>
					ch.assertExchange(b.exchange, b.exchangeType ?? 'topic', { durable: true })
				)
			)

			await ch.assertQueue(queue, { durable: true, arguments: queueArgs })

			await Promise.all(bindings.map((b) => ch.bindQueue(queue, b.exchange, b.routingKey)))

			await ch.prefetch(prefetch)
			await ch.consume(queue, (msg) => {
				if (!msg) return
				void this.dispatch(ch, msg, queue)
			})
		})
	}

	private async dispatch(ch: Channel, msg: ConsumeMessage, queue: string): Promise<void> {
		const meta = getConsumerMetadata(this)
		const dlq = meta?.dlq

		try {
			const raw = JSON.parse(msg.content.toString())
			const payload = this.schema.parse(raw)
			const ctx: ConsumerCtx = {
				messageId: msg.properties.messageId,
				deathCount: this.deathCount(msg, queue),
				headers: msg.properties.headers ?? {},
				rawMessage: msg
			}

			await this.handle(payload, ctx)
			ch.ack(msg)
		} catch (error) {
			await this.handleError(ch, msg, queue, error, dlq)
		}
	}

	private async handleError(
		ch: Channel,
		msg: ConsumeMessage,
		queue: string,
		error: unknown,
		dlq: ConsumerDlq | undefined
	): Promise<void> {
		const deathCount = this.deathCount(msg, queue)
		const baseLog = {
			error,
			queue,
			messageId: msg.properties.messageId,
			deathCount
		}

		if (dlq && deathCount + 1 >= dlq.maxAttempts) {
			try {
				ch.publish(dlq.exchange, dlq.routingKey, msg.content, {
					...msg.properties,
					headers: { ...msg.properties.headers }
				})
				ch.ack(msg)
				this.logger.error(baseLog, 'consumer exhausted retries — routed to DLQ')
				return
			} catch (publishError) {
				this.logger.error(
					{ ...baseLog, publishError },
					'DLQ publish failed — falling back to nack-no-requeue'
				)
			}
		}

		this.logger.error(baseLog, 'consumer handler failed — nack-no-requeue')
		ch.nack(msg, false, false)
	}

	protected deathCount(msg: Message, queue: string): number {
		const xDeath = msg.properties.headers?.['x-death'] as
			| { count: number; queue: string }[]
			| undefined

		return xDeath?.find((d) => d.queue === queue)?.count ?? 0
	}
}
