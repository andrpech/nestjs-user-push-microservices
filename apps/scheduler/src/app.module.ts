import { Module } from '@nestjs/common'

import { LoggerModule } from '@app/common'
import { RmqModule } from '@app/rmq'
import { ConfigurationModule } from './config'
import { HealthModule } from './health/health.module'
import { SchedulerModule } from './modules/scheduler/scheduler.module'

@Module({
	imports: [
		LoggerModule,
		ConfigurationModule,
		RmqModule.forRoot({ url: (): string => process.env.RABBITMQ_URL ?? '' }),
		HealthModule,
		SchedulerModule
	]
})
export class AppModule {}
