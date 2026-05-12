import { Module } from '@nestjs/common'

import { MetricsService, QueueDepthPoller } from '@app/metrics'
import { ConfigurationInjectKey, ConfigurationModule, ConfigurationType } from '../../config'
import { NotificationsDatabaseModule } from '../../database/notifications.database.module'
import { RecordSendAttemptCommand } from './commands/record-send-attempt.command'
import { IngestConsumer } from './consumers/ingest.consumer'
import { NotifierCronConsumer } from './consumers/notifier-cron.consumer'
import { PushSendConsumer } from './consumers/push-send.consumer'
import { NotifierTopologyService } from './notifier-topology.service'
import { PushSendRetryProducer } from './producers/push-send-retry.producer'
import { PushSendProducer } from './producers/push-send.producer'
import { NotificationsRepository } from './repositories/notifications.repository'
import { NotificationStateMachine } from './state-machine/notification.state-machine'
import { WebhookTransport } from './transport/webhook.transport'
import { createTypeCatalog, TYPE_CATALOG_TOKEN, TypeCatalog } from './type-catalog/type-catalog'

const NOTIFIER_QUEUES = [
	'notifier.ingest',
	'notifier.ingest.retry',
	'notifier.ingest.dlq',
	'notifier.push-send',
	'notifier.push-send.retry',
	'notifier.cron'
] as const

@Module({
	imports: [NotificationsDatabaseModule, ConfigurationModule],
	providers: [
		// deep modules
		NotificationsRepository,
		NotificationStateMachine,
		WebhookTransport,
		{
			provide: TYPE_CATALOG_TOKEN,
			inject: [ConfigurationInjectKey],
			useFactory: (cfg: ConfigurationType): TypeCatalog =>
				createTypeCatalog({
					userWelcomeDelayMs: cfg.notifier.notificationDelayMs,
					userWelcomeMaxAttempts: cfg.push.maxAttempts
				})
		},
		// use-case commands
		RecordSendAttemptCommand,
		// rmq pieces
		PushSendProducer,
		PushSendRetryProducer,
		IngestConsumer,
		NotifierCronConsumer,
		PushSendConsumer,
		// topology bootstrap (asserts retry/DLQ queues that have no consumers)
		NotifierTopologyService,
		// observability
		{
			provide: QueueDepthPoller,
			inject: [MetricsService],
			useFactory: (metrics: MetricsService): QueueDepthPoller =>
				new QueueDepthPoller({
					managementUrl: process.env.RABBITMQ_MGMT_URL ?? '',
					queues: NOTIFIER_QUEUES,
					gauge: metrics.rmqQueueDepth
				})
		}
	],
	exports: [NotificationsDatabaseModule, NotificationStateMachine, NotificationsRepository]
})
export class NotifierModule {}
