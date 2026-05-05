import { Injectable } from '@nestjs/common'

import { CreateUserCommand, CreateUserOutput } from './commands/create-user.command'
import { CreateUserDto } from './dto/create-user.dto'

@Injectable()
export class UsersService {
	constructor(private readonly createUserCommand: CreateUserCommand) {}

	createUser(dto: CreateUserDto): Promise<CreateUserOutput> {
		return this.createUserCommand.execute(dto)
	}
}
