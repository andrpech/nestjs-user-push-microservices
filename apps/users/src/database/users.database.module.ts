import { createDatabaseModule } from '@app/database-core'
import { MetricsService, QueryObserver } from '@app/metrics'
import { PrismaClient } from '../../prisma/generated'
import { UsersReadPrismaClient, UsersWritePrismaClient } from './users.clients'

const observerFactory = (...deps: unknown[]): QueryObserver =>
	(deps[0] as MetricsService).observePrismaQuery

export const UsersDatabaseModule = createDatabaseModule([
	{
		token: UsersReadPrismaClient,
		ctor: PrismaClient,
		url: (): string => process.env.USERS_READ_DB_URL ?? '',
		inject: [MetricsService],
		observerFactory
	},
	{
		token: UsersWritePrismaClient,
		ctor: PrismaClient,
		url: (): string => process.env.USERS_WRITE_DB_URL ?? '',
		inject: [MetricsService],
		observerFactory
	}
])
