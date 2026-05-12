import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import type { ChannelWrapper } from 'amqp-connection-manager'
import type { ConfirmChannel } from 'amqplib'

import { ulid } from '@app/common'
import { getProducerMetadata } from './decorators/producer.decorator'
import { RmqConnection } from './rmq-connection'
import type { PublishOpts } from './types'

// @Injectable() on the abstract base makes TS emit `design:paramtypes`, so
// stub subclasses that only carry a @Producer({...}) decorator don't need
// to redeclare a constructor for NestJS DI to find RmqConnection via the
// prototype chain.
@Injectable()
export abstract class RmqProducer<T> implements OnModuleInit {
	protected readonly logger: Logger = new Logger(this.constructor.name)
	protected channel: ChannelWrapper | undefined

	constructor(protected readonly conn: RmqConnection) {}

	onModuleInit(): void {
		const meta = getProducerMetadata(this)
		if (!meta) {
			throw new Error(`@Producer({...}) decorator missing on ${this.constructor.name}`)
		}

		const { exchange, exchangeType = 'topic', exchangeArgs } = meta
		this.channel = this.conn.createConfirmChannel()
		void this.channel.addSetup(async (ch: ConfirmChannel) => {
			await ch.assertExchange(exchange, exchangeType, {
				durable: true,
				arguments: exchangeArgs
			})
			ch.on('return', (msg) => {
				this.logger.warn(
					{
						exchange: meta.exchange,
						routingKey: meta.routingKey,
						messageId: msg.properties.messageId,
						fields: msg.fields
					},
					'unrouted message'
				)
			})
		})
	}

	async publish(payload: T, opts: PublishOpts = {}): Promise<void> {
		const meta = getProducerMetadata(this)
		if (!meta || !this.channel) {
			throw new Error(`Producer not initialized: ${this.constructor.name}`)
		}

		const body = Buffer.from(JSON.stringify(payload))
		const routingKey = opts.routingKey ?? meta.routingKey

		await this.channel.publish(meta.exchange, routingKey, body, {
			persistent: true,
			contentType: 'application/json',
			messageId: opts.messageId ?? ulid(),
			timestamp: Date.now(),
			mandatory: opts.mandatory ?? true,
			expiration: opts.expiration?.toString(),
			headers: opts.headers
		})
	}
}
