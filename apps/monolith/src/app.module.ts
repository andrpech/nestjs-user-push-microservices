import { Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'

import { LoggerModule } from '@app/common'
import { BaseZodValidationInterceptor } from '@app/zod-validation'
import { ConfigurationModule } from './config'
import { HealthModule } from './health/health.module'
import { UsersModule } from './modules/users/users.module'

@Module({
	imports: [LoggerModule, ConfigurationModule, HealthModule, UsersModule],
	providers: [
		{
			provide: APP_INTERCEPTOR,
			useClass: BaseZodValidationInterceptor
		}
	]
})
export class AppModule {}
