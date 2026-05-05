import { createDatabaseModule } from '@app/database-core'
import { MetricsService, QueryObserver } from '@app/metrics'
import { PrismaClient } from '../../prisma/generated'
import {
	NotificationsReadPrismaClient,
	NotificationsWritePrismaClient
} from './notifications.clients'

const observerFactory = (...deps: unknown[]): QueryObserver =>
	(deps[0] as MetricsService).observePrismaQuery

export const NotificationsDatabaseModule = createDatabaseModule([
	{
		token: NotificationsReadPrismaClient,
		ctor: PrismaClient,
		url: (): string => process.env.NOTIFICATIONS_READ_DB_URL ?? '',
		inject: [MetricsService],
		observerFactory
	},
	{
		token: NotificationsWritePrismaClient,
		ctor: PrismaClient,
		url: (): string => process.env.NOTIFICATIONS_WRITE_DB_URL ?? '',
		inject: [MetricsService],
		observerFactory
	}
])
