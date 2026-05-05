import { PrismaClient } from '../../prisma/notifications/generated'

// Marker classes used as DI tokens and TypeScript types.
// The DI factory in NotificationsDatabaseModule provides the actual extended PrismaClient under each token.
export class NotificationsReadPrismaClient extends PrismaClient {}
export class NotificationsWritePrismaClient extends PrismaClient {}
