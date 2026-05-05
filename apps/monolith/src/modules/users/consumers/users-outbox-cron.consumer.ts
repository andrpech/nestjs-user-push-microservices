import { Injectable } from '@nestjs/common'
import { ZodType } from 'zod'

import { Consumer, RmqConnection, RmqConsumer } from '@app/rmq'
import { CronTick, CronTickSchema } from '../../scheduler/dto/cron-tick.dto'
import { ClaimAndPublishUsersCommand } from '../commands/claim-and-publish-users.command'

@Injectable()
@Consumer({
	queue: 'users.outbox-cron',
	prefetch: 1,
	bindings: [
		{
			exchange: 'system.cron',
			routingKey: 'cron.users',
			exchangeType: 'topic'
		}
	]
})
export class UsersOutboxCronConsumer extends RmqConsumer<CronTick> {
	protected readonly schema: ZodType<CronTick> = CronTickSchema

	constructor(
		conn: RmqConnection,
		private readonly claimAndPublish: ClaimAndPublishUsersCommand
	) {
		super(conn)
	}

	async handle(): Promise<void> {
		await this.claimAndPublish.execute()
	}
}
