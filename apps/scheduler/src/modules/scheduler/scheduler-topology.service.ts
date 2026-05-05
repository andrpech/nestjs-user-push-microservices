import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import type { ChannelWrapper } from 'amqp-connection-manager'
import type { Channel } from 'amqplib'

import { RmqConnection } from '@app/rmq'

// Phase 13 — declares the alternate-exchange catch-all (`unrouted.alt`
// fanout + `unrouted` queue) and idempotently deletes any pre-existing
// `system.cron` exchange whose args differ from what producers will
// re-assert with the AE config.
@Injectable()
export class SchedulerTopologyService implements OnModuleInit {
	private readonly logger = new Logger(SchedulerTopologyService.name)
	private channel: ChannelWrapper | undefined

	constructor(private readonly conn: RmqConnection) {}

	async onModuleInit(): Promise<void> {
		this.channel = this.conn.createChannel()
		await this.channel.addSetup(async (ch: Channel) => {
			// Producer + consumer asserts of `system.cron` already include
			// `arguments: { 'alternate-exchange': 'unrouted.alt' }`, so no delete
			// is needed — assertExchange is idempotent when args match.
			await ch.assertExchange('unrouted.alt', 'fanout', { durable: true })
			await ch.assertQueue('unrouted', { durable: true })
			await ch.bindQueue('unrouted', 'unrouted.alt', '')

			this.logger.log('phase 13 alternate-exchange topology asserted')
		})
	}
}
