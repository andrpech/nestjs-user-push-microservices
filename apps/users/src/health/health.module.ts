import { Module } from '@nestjs/common'
import { TerminusModule } from '@nestjs/terminus'

import { UsersDatabaseModule } from '../database/users.database.module'
import { HealthController } from './health.controller'
import { HealthService } from './health.service'

@Module({
	imports: [TerminusModule, UsersDatabaseModule],
	controllers: [HealthController],
	providers: [HealthService]
})
export class HealthModule {}
