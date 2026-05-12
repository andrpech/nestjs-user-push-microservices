import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import type { ChannelWrapper } from 'amqp-connection-manager'
import type { Channel } from 'amqplib'

import { RmqConnection } from '@app/rmq'

const INGEST_RETRY_TTL_MS = 5_000

// v2 ingest topology. The notifier owns:
//   - notifications.ingest      — single inbound exchange for every type
//   - notifier.ingest queue     — bound to ingest.# via IngestConsumer decorator
//   - notifier.ingest.retry     — 5s TTL ring for transient ingest failures
//   - notifier.ingest.dlq       — terminal storage for exhausted-retry messages
//   - notifications.work + retry.work + push-send.retry — unchanged send-side path
@Injectable()
export class NotifierTopologyService implements OnModuleInit {
	private readonly logger = new Logger(NotifierTopologyService.name)
	private channel: ChannelWrapper | undefined

	constructor(private readonly conn: RmqConnection) {}

	async onModuleInit(): Promise<void> {
		this.channel = this.conn.createChannel()
		await this.channel.addSetup(async (ch: Channel) => {
			await Promise.all([
				ch.assertExchange('notifications.work', 'topic', { durable: true }),
				ch.assertExchange('notifications.retry.work', 'topic', { durable: true }),
				ch.assertExchange('notifications.ingest', 'topic', { durable: true }),
				ch.assertExchange('notifications.retry.events', 'topic', { durable: true }),
				ch.assertExchange('notifications.dlx', 'topic', { durable: true })
			])

			// Send-side retry queue: per-message expiration; on TTL → notifications.work / push.send
			await ch.assertQueue('notifier.push-send.retry', {
				durable: true,
				arguments: {
					'x-dead-letter-exchange': 'notifications.work',
					'x-dead-letter-routing-key': 'push.send'
				}
			})
			await ch.bindQueue('notifier.push-send.retry', 'notifications.retry.work', 'push.send')

			// Ingest-side retry queue: 5s TTL; on TTL → notifications.ingest with the
			// original routing key preserved (no x-dead-letter-routing-key override).
			await ch.assertQueue('notifier.ingest.retry', {
				durable: true,
				arguments: {
					'x-dead-letter-exchange': 'notifications.ingest',
					'x-message-ttl': INGEST_RETRY_TTL_MS
				}
			})
			await ch.bindQueue('notifier.ingest.retry', 'notifications.retry.events', 'ingest.#')

			// Terminal DLQ — populated by IngestConsumer's base-class DLX publish.
			await ch.assertQueue('notifier.ingest.dlq', { durable: true })
			await ch.bindQueue('notifier.ingest.dlq', 'notifications.dlx', 'ingest.#')

			this.logger.log('v2 ingest topology asserted')
		})
	}
}
