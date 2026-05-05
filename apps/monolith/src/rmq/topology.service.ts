import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import type { ChannelWrapper } from 'amqp-connection-manager'
import type { Channel } from 'amqplib'

import { RmqConnection } from '@app/rmq'

type ExchangeDecl = {
	name: string
	type: 'topic' | 'direct' | 'fanout' | 'headers'
}

type QueueDecl = {
	name: string
	bindings: { exchange: string; routingKey: string }[]
}

const EXCHANGES: ExchangeDecl[] = [
	{ name: 'system.cron', type: 'topic' },
	{ name: 'users.events', type: 'topic' }
]

// Placeholder queues for phases 4/5 — declared now so phase-3 publishes don't
// trip mandatory return listeners. Consumers attach in their own phases.
const QUEUES: QueueDecl[] = [
	{
		name: 'notifier.user-created',
		bindings: [{ exchange: 'users.events', routingKey: 'user.created' }]
	},
	{
		name: 'notifier.cron',
		bindings: [{ exchange: 'system.cron', routingKey: 'cron.notifier' }]
	}
]

@Injectable()
export class TopologyService implements OnModuleInit {
	private readonly logger = new Logger(TopologyService.name)
	private channel: ChannelWrapper | undefined

	constructor(private readonly conn: RmqConnection) {}

	async onModuleInit(): Promise<void> {
		this.channel = this.conn.createChannel()
		await this.channel.addSetup(async (ch: Channel) => {
			await Promise.all(
				EXCHANGES.map((ex) => ch.assertExchange(ex.name, ex.type, { durable: true }))
			)

			await Promise.all(
				QUEUES.map(async (q) => {
					await ch.assertQueue(q.name, { durable: true })
					await Promise.all(q.bindings.map((b) => ch.bindQueue(q.name, b.exchange, b.routingKey)))
				})
			)

			this.logger.log('rmq topology asserted')
		})
	}
}
