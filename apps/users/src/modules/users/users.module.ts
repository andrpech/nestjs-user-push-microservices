import { Module } from '@nestjs/common'

import { MetricsService, QueueDepthPoller } from '@app/metrics'
import { ConfigurationModule } from '../../config'
import { UsersDatabaseModule } from '../../database/users.database.module'
import { ClaimAndPublishUsersCommand } from './commands/claim-and-publish-users.command'
import { CreateUserCommand } from './commands/create-user.command'
import { UsersOutboxCronConsumer } from './consumers/users-outbox-cron.consumer'
import { IngestProducer } from './producers/ingest.producer'
import { UsersOutboxRepository } from './repositories/users-outbox.repository'
import { UsersController } from './users.controller'
import { UsersService } from './users.service'

const USERS_QUEUES = ['users.outbox-cron'] as const

@Module({
	imports: [UsersDatabaseModule, ConfigurationModule],
	controllers: [UsersController],
	providers: [
		UsersService,
		UsersOutboxRepository,
		CreateUserCommand,
		ClaimAndPublishUsersCommand,
		IngestProducer,
		UsersOutboxCronConsumer,
		{
			provide: QueueDepthPoller,
			inject: [MetricsService],
			useFactory: (metrics: MetricsService): QueueDepthPoller =>
				new QueueDepthPoller({
					managementUrl: process.env.RABBITMQ_MGMT_URL ?? '',
					queues: USERS_QUEUES,
					gauge: metrics.rmqQueueDepth
				})
		}
	]
})
export class UsersModule {}
