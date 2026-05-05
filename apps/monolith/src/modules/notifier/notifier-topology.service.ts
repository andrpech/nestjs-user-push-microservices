import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import type { ChannelWrapper } from 'amqp-connection-manager'
import type { Channel } from 'amqplib'

import { RmqConnection } from '@app/rmq'

const RETRY_TTL_MS = 5_000

// Phase 6 retry/DLQ topology — declared at boot so the (consumer-less) retry queues
// and the DLQ exist before any failure-mode message hits them. Idempotent.
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
				ch.assertExchange('users.events', 'topic', { durable: true }),
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

			// Inbox-side retry queue: fixed 5s TTL; on TTL → users.events / user.created
			await ch.assertQueue('notifier.user-created.retry', {
				durable: true,
				arguments: {
					'x-dead-letter-exchange': 'users.events',
					'x-dead-letter-routing-key': 'user.created',
					'x-message-ttl': RETRY_TTL_MS
				}
			})
			await ch.bindQueue(
				'notifier.user-created.retry',
				'notifications.retry.events',
				'user.created'
			)

			// Terminal DLQ — populated explicitly by the consumer when retries exhaust
			await ch.assertQueue('notifier.user-created.dlq', { durable: true })
			await ch.bindQueue('notifier.user-created.dlq', 'notifications.dlx', 'user.created')

			this.logger.log('phase 6 retry topology asserted')
		})
	}
}
