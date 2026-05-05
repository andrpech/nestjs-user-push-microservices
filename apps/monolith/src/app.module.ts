import { Module } from '@nestjs/common'

import { LoggerModule } from '@app/common'
import { ConfigurationModule } from './config'
import { HealthModule } from './health/health.module'

@Module({
	imports: [LoggerModule, ConfigurationModule, HealthModule]
})
export class AppModule {}
