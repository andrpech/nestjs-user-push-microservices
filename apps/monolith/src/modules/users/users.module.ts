import { Module } from '@nestjs/common'

import { ConfigurationModule } from '../../config'
import { UsersDatabaseModule } from '../../database/users.database.module'
import { ClaimAndPublishUsersCommand } from './commands/claim-and-publish-users.command'
import { CreateUserCommand } from './commands/create-user.command'
import { UsersOutboxCronConsumer } from './consumers/users-outbox-cron.consumer'
import { UserCreatedProducer } from './producers/user-created.producer'
import { UsersController } from './users.controller'
import { UsersService } from './users.service'

@Module({
	imports: [UsersDatabaseModule, ConfigurationModule],
	controllers: [UsersController],
	providers: [
		UsersService,
		CreateUserCommand,
		ClaimAndPublishUsersCommand,
		UserCreatedProducer,
		UsersOutboxCronConsumer
	]
})
export class UsersModule {}
