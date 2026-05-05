import { Logger, OnModuleInit } from '@nestjs/common'
import type { ChannelWrapper } from 'amqp-connection-manager'
import type { Channel, ConfirmChannel } from 'amqplib'

import { ulid } from '@app/common'
import { getProducerMetadata } from './decorators/producer.decorator'
import { RmqConnection } from './rmq-connection'
import type { PublishOpts } from './types'

export abstract class RmqProducer<T> implements OnModuleInit {
	protected readonly logger: Logger = new Logger(this.constructor.name)
	protected channel: ChannelWrapper | undefined

	constructor(protected readonly conn: RmqConnection) {}

	onModuleInit(): void {
		const meta = getProducerMetadata(this)
		if (!meta) {
			throw new Error(`@Producer({...}) decorator missing on ${this.constructor.name}`)
		}

		this.channel = this.conn.createConfirmChannel()
		void this.channel.addSetup(async (ch: Channel | ConfirmChannel) => {
			ch.on('return', (msg) => {
				this.logger.warn(
					{ exchange: meta.exchange, routingKey: meta.routingKey, fields: msg.fields },
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

		await this.channel.publish(meta.exchange, meta.routingKey, body, {
			persistent: true,
			contentType: 'application/json',
			messageId: ulid(),
			timestamp: Date.now(),
			mandatory: true,
			expiration: opts.expiration?.toString(),
			headers: opts.headers
		})
	}
}
