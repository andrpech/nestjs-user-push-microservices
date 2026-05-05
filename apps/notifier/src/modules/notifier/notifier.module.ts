import { Module } from '@nestjs/common'

import { ConfigurationModule } from '../../config'
import { NotificationsDatabaseModule } from '../../database/notifications.database.module'
import { ClaimDueNotificationsCommand } from './commands/claim-due-notifications.command'
import { CreateNotificationCommand } from './commands/create-notification.command'
import { MarkAttemptFailedCommand } from './commands/mark-attempt-failed.command'
import { MarkSentCommand } from './commands/mark-sent.command'
import { MarkTerminalFailedCommand } from './commands/mark-terminal-failed.command'
import { RecoverStuckNotificationsCommand } from './commands/recover-stuck-notifications.command'
import { SendPushCommand } from './commands/send-push.command'
import { NotifierCronConsumer } from './consumers/notifier-cron.consumer'
import { PushSendConsumer } from './consumers/push-send.consumer'
import { UserCreatedConsumer } from './consumers/user-created.consumer'
import { NotifierTopologyService } from './notifier-topology.service'
import { PushSendRetryProducer } from './producers/push-send-retry.producer'
import { PushSendProducer } from './producers/push-send.producer'

@Module({
	imports: [NotificationsDatabaseModule, ConfigurationModule],
	providers: [
		// commands
		CreateNotificationCommand,
		ClaimDueNotificationsCommand,
		RecoverStuckNotificationsCommand,
		SendPushCommand,
		MarkSentCommand,
		MarkAttemptFailedCommand,
		MarkTerminalFailedCommand,
		// rmq pieces
		PushSendProducer,
		PushSendRetryProducer,
		UserCreatedConsumer,
		NotifierCronConsumer,
		PushSendConsumer,
		// topology bootstrap (asserts retry/DLQ queues with no consumers)
		NotifierTopologyService
	],
	exports: [NotificationsDatabaseModule]
})
export class NotifierModule {}
