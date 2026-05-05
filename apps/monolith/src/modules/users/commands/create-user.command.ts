import { Inject, Injectable } from '@nestjs/common'

import { Command, ulid } from '@app/common'
import { UsersWritePrismaClient } from '../../../database/users.clients'

export interface CreateUserInput {
	name: string
}

export interface CreateUserOutput {
	id: string
	name: string
	createdAt: Date
}

@Injectable()
export class CreateUserCommand implements Command<CreateUserInput, CreateUserOutput> {
	constructor(
		@Inject(UsersWritePrismaClient)
		private readonly write: UsersWritePrismaClient
	) {}

	async execute({ name }: CreateUserInput): Promise<CreateUserOutput> {
		const user = await this.write.user.create({
			data: { id: ulid(), name }
		})

		return { id: user.id, name: user.name, createdAt: user.createdAt }
	}
}
