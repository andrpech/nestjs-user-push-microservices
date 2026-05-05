import { Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'

import { LoggerModule } from '@app/common'
import { RmqModule } from '@app/rmq'
import { BaseZodValidationInterceptor } from '@app/zod-validation'
import { ConfigurationModule } from './config'
import { HealthModule } from './health/health.module'
import { NotifierModule } from './modules/notifier/notifier.module'
import { SchedulerModule } from './modules/scheduler/scheduler.module'
import { UsersModule } from './modules/users/users.module'
import { TopologyModule } from './rmq/topology.module'

@Module({
	imports: [
		LoggerModule,
		ConfigurationModule,
		RmqModule.forRoot({ url: (): string => process.env.RABBITMQ_URL ?? '' }),
		TopologyModule,
		HealthModule,
		UsersModule,
		NotifierModule,
		SchedulerModule
	],
	providers: [
		{
			provide: APP_INTERCEPTOR,
			useClass: BaseZodValidationInterceptor
		}
	]
})
export class AppModule {}
