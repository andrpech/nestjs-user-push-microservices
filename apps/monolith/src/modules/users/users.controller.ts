import { Body, Controller, HttpCode, Post } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { ZodSchema } from '@app/zod-validation'
import { CreateUserDto, CreateUserSchema } from './dto/create-user.dto'
import { UsersService } from './users.service'

@Controller('users')
export class UsersController {
	constructor(
		private readonly usersService: UsersService,
		private readonly logger: PinoLogger
	) {}

	@Post()
	@HttpCode(201)
	@ZodSchema(CreateUserSchema)
	async create(
		@Body() body: CreateUserDto
	): Promise<{ id: string; name: string; createdAt: Date }> {
		const user = await this.usersService.createUser(body)
		this.logger.assign({ userId: user.id })
		return user
	}
}
