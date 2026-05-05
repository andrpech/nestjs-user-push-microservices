import { Module } from '@nestjs/common'
import { TerminusModule } from '@nestjs/terminus'

import { NotificationsDatabaseModule } from '../database/notifications.database.module'
import { HealthController } from './health.controller'
import { HealthService } from './health.service'

@Module({
	imports: [TerminusModule, NotificationsDatabaseModule],
	controllers: [HealthController],
	providers: [HealthService]
})
export class HealthModule {}
