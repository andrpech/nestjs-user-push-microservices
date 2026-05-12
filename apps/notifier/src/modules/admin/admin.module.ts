import { Module } from '@nestjs/common'

import { NotificationsDatabaseModule } from '../../database/notifications.database.module'
import { NotifierModule } from '../notifier/notifier.module'
import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'
import { RepublishInboxDlqCommand } from './commands/republish-inbox-dlq.command'
import { RetryNotificationCommand } from './commands/retry-notification.command'
import { IngestProducer } from './producers/ingest.producer'

@Module({
	imports: [NotificationsDatabaseModule, NotifierModule],
	controllers: [AdminController],
	providers: [AdminService, RetryNotificationCommand, RepublishInboxDlqCommand, IngestProducer]
})
export class AdminModule {}
