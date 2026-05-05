import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common'
import type { ChannelWrapper } from 'amqp-connection-manager'
import type { Channel, ConsumeMessage, Message } from 'amqplib'
import { ZodType } from 'zod'

import { ConsumerDlq, getConsumerMetadata } from './decorators/consumer.decorator'
import { RmqConnection } from './rmq-connection'
import type { ConsumerCtx } from './types'

const SHUTDOWN_DRAIN_TIMEOUT_MS = 10_000

@Injectable()
export abstract class RmqConsumer<T> implements OnModuleInit, OnApplicationShutdown {
	protected readonly logger: Logger = new Logger(this.constructor.name)
	protected abstract readonly schema: ZodType<T>
	protected channel: ChannelWrapper | undefined
	private consumerTag: string | undefined
	private inFlight = 0
	private drainResolve: (() => void) | undefined
	private shuttingDown = false

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
					ch.assertExchange(b.exchange, b.exchangeType ?? 'topic', {
						durable: true,
						arguments: b.exchangeArgs
					})
				)
			)

			await ch.assertQueue(queue, { durable: true, arguments: queueArgs })

			await Promise.all(bindings.map((b) => ch.bindQueue(queue, b.exchange, b.routingKey)))

			await ch.prefetch(prefetch)
			const { consumerTag } = await ch.consume(queue, (msg) => {
				if (!msg) return
				if (this.shuttingDown) {
					ch.nack(msg, false, true)
					return
				}
				this.inFlight++
				void this.dispatch(ch, msg, queue).finally(() => {
					this.inFlight--
					if (this.shuttingDown && this.inFlight === 0 && this.drainResolve) {
						this.drainResolve()
					}
				})
			})
			this.consumerTag = consumerTag
		})
	}

	async onApplicationShutdown(signal?: string): Promise<void> {
		// Bypass pino so the message lands on stdout synchronously even if pino's
		// transport worker has already torn down by the time onApplicationShutdown
		// fires (which is late in the shutdown sequence).
		process.stdout.write(
			`[shutdown] consumer ${this.constructor.name} got ${signal ?? 'unknown'}\n`
		)
		if (!this.channel || !this.consumerTag) return
		this.shuttingDown = true
		try {
			await this.channel.cancel(this.consumerTag)
		} catch (error) {
			this.logger.warn(
				{ error: error instanceof Error ? error.message : String(error) },
				'consumer cancel during shutdown failed'
			)
		}
		if (this.inFlight > 0) {
			await new Promise<void>((resolve): void => {
				this.drainResolve = resolve
				setTimeout((): void => {
					this.logger.warn({ remaining: this.inFlight }, 'consumer drain timeout — proceeding')
					resolve()
				}, SHUTDOWN_DRAIN_TIMEOUT_MS).unref()
			})
		}
		process.stdout.write(`[shutdown] consumer ${this.constructor.name} drained cleanly\n`)
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
