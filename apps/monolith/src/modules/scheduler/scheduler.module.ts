import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'

import { ConfigurationModule } from '../../config'
import { NotifierCronProducer } from './producers/notifier-cron.producer'
import { UsersCronProducer } from './producers/users-cron.producer'
import { SchedulerService } from './scheduler.service'

@Module({
	imports: [ScheduleModule.forRoot(), ConfigurationModule],
	providers: [SchedulerService, UsersCronProducer, NotifierCronProducer]
})
export class SchedulerModule {}
