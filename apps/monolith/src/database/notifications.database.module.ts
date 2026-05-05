import { createDatabaseModule } from '@app/database-core'
import { PrismaClient } from '../../prisma/notifications/generated'
import {
	NotificationsReadPrismaClient,
	NotificationsWritePrismaClient
} from './notifications.clients'

export const NotificationsDatabaseModule = createDatabaseModule([
	{
		token: NotificationsReadPrismaClient,
		ctor: PrismaClient,
		url: (): string => process.env.NOTIFICATIONS_READ_DB_URL ?? ''
	},
	{
		token: NotificationsWritePrismaClient,
		ctor: PrismaClient,
		url: (): string => process.env.NOTIFICATIONS_WRITE_DB_URL ?? ''
	}
])
