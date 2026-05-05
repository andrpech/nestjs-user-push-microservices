import { Module } from '@nestjs/common'

import { NotificationsDatabaseModule } from '../../database/notifications.database.module'
import { CreateNotificationCommand } from './commands/create-notification.command'
import { UserCreatedConsumer } from './consumers/user-created.consumer'

@Module({
	imports: [NotificationsDatabaseModule],
	providers: [CreateNotificationCommand, UserCreatedConsumer],
	exports: [NotificationsDatabaseModule]
})
export class NotifierModule {}
