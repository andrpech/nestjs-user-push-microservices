import { Inject, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { ZodType } from 'zod'

import { Consumer, RmqConnection, RmqConsumer } from '@app/rmq'
import { ConfigurationInjectKey, ConfigurationType } from '../../../config'
import { CronTick, CronTickSchema } from '../dto/cron-tick.dto'
import { PushSendProducer } from '../producers/push-send.producer'
import { NotificationStateMachine } from '../state-machine/notification.state-machine'

@Injectable()
@Consumer({
	queue: 'notifier.cron',
	prefetch: 1,
	bindings: [
		{
			exchange: 'system.cron',
			routingKey: 'cron.notifier',
			exchangeType: 'topic',
			exchangeArgs: { 'alternate-exchange': 'unrouted.alt' }
		}
	]
})
export class NotifierCronConsumer extends RmqConsumer<CronTick> {
	protected readonly schema: ZodType<CronTick> = CronTickSchema

	constructor(
		conn: RmqConnection,
		@Inject(ConfigurationInjectKey)
		private readonly config: ConfigurationType,
		private readonly stateMachine: NotificationStateMachine,
		private readonly producer: PushSendProducer,
		private readonly pinoLogger: PinoLogger
	) {
		super(conn)
		this.pinoLogger.setContext(NotifierCronConsumer.name)
	}

	async handle(): Promise<void> {
		const { recovered, failed: recoveryFailed } = await this.stateMachine.recoverStuck({
			thresholdMs: this.config.notifier.recoveryThresholdMs,
			maxRedrives: this.config.retry.maxRedrives
		})

		const claimed = await this.stateMachine.claim(this.config.notifier.batchSize)

		await Promise.all(
			claimed.map((row) => this.producer.publish({ notificationId: row.id }, { messageId: row.id }))
		)

		if (recovered > 0 || recoveryFailed > 0 || claimed.length > 0) {
			this.pinoLogger.info(
				{
					recovered,
					recoveryFailed,
					claimed: claimed.length,
					dispatched: claimed.length
				},
				'notifier tick'
			)
		}
	}
}
