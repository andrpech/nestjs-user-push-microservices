import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'

import { ConfigurationModule } from '../../config'
import { NotifierCronProducer } from './producers/notifier-cron.producer'
import { UsersCronProducer } from './producers/users-cron.producer'
import { SchedulerTopologyService } from './scheduler-topology.service'
import { SchedulerService } from './scheduler.service'

@Module({
	imports: [ScheduleModule.forRoot(), ConfigurationModule],
	// Order matters — SchedulerTopologyService must run its onModuleInit before
	// the producers re-assert `system.cron` with the alternate-exchange arg.
	providers: [SchedulerTopologyService, SchedulerService, UsersCronProducer, NotifierCronProducer]
})
export class SchedulerModule {}
