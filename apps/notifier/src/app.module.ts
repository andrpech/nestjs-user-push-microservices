import { Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'

import { LoggerModule } from '@app/common'
import { MetricsModule } from '@app/metrics'
import { RmqModule } from '@app/rmq'
import { BaseZodValidationInterceptor } from '@app/zod-validation'
import { ConfigurationModule } from './config'
import { HealthModule } from './health/health.module'
import { AdminModule } from './modules/admin/admin.module'
import { NotifierModule } from './modules/notifier/notifier.module'

@Module({
	imports: [
		LoggerModule,
		ConfigurationModule,
		MetricsModule,
		RmqModule.forRoot({ url: (): string => process.env.RABBITMQ_URL ?? '' }),
		HealthModule,
		NotifierModule,
		AdminModule
	],
	providers: [
		{
			provide: APP_INTERCEPTOR,
			useClass: BaseZodValidationInterceptor
		}
	]
})
export class AppModule {}
