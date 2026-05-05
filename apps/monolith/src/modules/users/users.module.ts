import { Module } from '@nestjs/common'

import { UsersDatabaseModule } from '../../database/users.database.module'
import { CreateUserCommand } from './commands/create-user.command'
import { UsersController } from './users.controller'
import { UsersService } from './users.service'

@Module({
	imports: [UsersDatabaseModule],
	controllers: [UsersController],
	providers: [UsersService, CreateUserCommand]
})
export class UsersModule {}
