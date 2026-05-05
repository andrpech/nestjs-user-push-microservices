import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { ZodType } from 'zod'

import { Consumer, RmqConnection, RmqConsumer } from '@app/rmq'
import { ClaimDueNotificationsCommand } from '../commands/claim-due-notifications.command'
import { RecoverStuckNotificationsCommand } from '../commands/recover-stuck-notifications.command'
import { CronTick, CronTickSchema } from '../dto/cron-tick.dto'
import { PushSendProducer } from '../producers/push-send.producer'

@Injectable()
@Consumer({
	queue: 'notifier.cron',
	prefetch: 1,
	bindings: [
		{
			exchange: 'system.cron',
			routingKey: 'cron.notifier',
			exchangeType: 'topic'
		}
	]
})
export class NotifierCronConsumer extends RmqConsumer<CronTick> {
	protected readonly schema: ZodType<CronTick> = CronTickSchema

	constructor(
		conn: RmqConnection,
		private readonly recover: RecoverStuckNotificationsCommand,
		private readonly claim: ClaimDueNotificationsCommand,
		private readonly producer: PushSendProducer,
		private readonly pinoLogger: PinoLogger
	) {
		super(conn)
		this.pinoLogger.setContext(NotifierCronConsumer.name)
	}

	async handle(): Promise<void> {
		const { recovered, failed: recoveryFailed } = await this.recover.execute()
		const claimed = await this.claim.execute()

		const dispatched = await Promise.all(
			claimed.map(async (n) => {
				await this.producer.publish(
					{ userId: n.userId, name: n.name, notificationId: n.id },
					{ messageId: n.id }
				)
				return n.id
			})
		)

		if (recovered > 0 || recoveryFailed > 0 || claimed.length > 0) {
			this.pinoLogger.info(
				{
					recovered,
					recoveryFailed,
					claimed: claimed.length,
					dispatched: dispatched.length
				},
				'notifier tick'
			)
		}
	}
}
