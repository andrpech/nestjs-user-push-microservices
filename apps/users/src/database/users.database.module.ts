import { createDatabaseModule } from '@app/database-core'
import { PrismaClient } from '../../prisma/generated'
import { UsersReadPrismaClient, UsersWritePrismaClient } from './users.clients'

export const UsersDatabaseModule = createDatabaseModule([
	{
		token: UsersReadPrismaClient,
		ctor: PrismaClient,
		url: (): string => process.env.USERS_READ_DB_URL ?? ''
	},
	{
		token: UsersWritePrismaClient,
		ctor: PrismaClient,
		url: (): string => process.env.USERS_WRITE_DB_URL ?? ''
	}
])
