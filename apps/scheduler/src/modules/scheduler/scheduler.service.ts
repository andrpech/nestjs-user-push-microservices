import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { SchedulerRegistry } from '@nestjs/schedule'
import { CronJob } from 'cron'
import { PinoLogger } from 'nestjs-pino'

import { ConfigurationInjectKey, ConfigurationType } from '../../config'
import { NotifierCronProducer } from './producers/notifier-cron.producer'
import { UsersCronProducer } from './producers/users-cron.producer'

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
	private readonly registeredJobs: string[] = []

	constructor(
		private readonly registry: SchedulerRegistry,
		@Inject(ConfigurationInjectKey)
		private readonly config: ConfigurationType,
		private readonly usersCronProducer: UsersCronProducer,
		private readonly notifierCronProducer: NotifierCronProducer,
		private readonly logger: PinoLogger
	) {
		this.logger.setContext(SchedulerService.name)
	}

	onModuleInit(): void {
		this.registerJob('cron.users', this.config.cron.usersExpr, () => {
			void this.fire(this.usersCronProducer, 'cron.users')
		})

		this.registerJob('cron.notifier', this.config.cron.notifierExpr, () => {
			void this.fire(this.notifierCronProducer, 'cron.notifier')
		})
	}

	private registerJob(name: string, expr: string, tick: () => void): void {
		const job = new CronJob(expr, tick)
		this.registry.addCronJob(name, job)
		this.registeredJobs.push(name)
		job.start()
		this.logger.info({ job: name, expr }, 'cron job registered')
	}

	onModuleDestroy(): void {
		for (const name of this.registeredJobs) {
			try {
				this.registry.deleteCronJob(name)
				this.logger.info({ job: name }, 'cron job stopped')
			} catch (error) {
				this.logger.warn(
					{ job: name, error: error instanceof Error ? error.message : String(error) },
					'cron job stop failed'
				)
			}
		}
	}

	private async fire(
		producer: UsersCronProducer | NotifierCronProducer,
		routingKey: string
	): Promise<void> {
		try {
			await producer.publish({ at: new Date().toISOString() })
		} catch (error) {
			this.logger.error({ error, routingKey }, 'cron publish failed')
		}
	}
}
