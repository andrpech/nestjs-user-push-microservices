import { PrismaClient } from '../../prisma/users/generated'

// Marker classes used as DI tokens and TypeScript types.
// The DI factory in UsersDatabaseModule provides the actual extended PrismaClient under each token.
export class UsersReadPrismaClient extends PrismaClient {}
export class UsersWritePrismaClient extends PrismaClient {}
