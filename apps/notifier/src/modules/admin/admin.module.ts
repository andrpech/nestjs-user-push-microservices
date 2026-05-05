import { Module } from '@nestjs/common'

import { NotificationsDatabaseModule } from '../../database/notifications.database.module'
import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'
import { RepublishInboxDlqCommand } from './commands/republish-inbox-dlq.command'
import { RetryNotificationCommand } from './commands/retry-notification.command'
import { UserCreatedProducer } from './producers/user-created.producer'

@Module({
	imports: [NotificationsDatabaseModule],
	controllers: [AdminController],
	providers: [AdminService, RetryNotificationCommand, RepublishInboxDlqCommand, UserCreatedProducer]
})
export class AdminModule {}
