import { DynamicModule, FactoryProvider, Logger, Module } from '@nestjs/common'

import { createExtendedPrismaClient } from './create-prisma-client'

type ExtensibleClient = {
	$extends: (def: unknown) => unknown
	$connect?: () => Promise<unknown>
}

type ClientConstructor<T extends ExtensibleClient> = new (opts: { datasourceUrl: string }) => T

export type DatabaseClientDef<T extends ExtensibleClient> = {
	token: symbol | (new (...args: unknown[]) => unknown)
	ctor: ClientConstructor<T>
	url: () => string
}

/**
 * Build a NestJS module exporting the given DI tokens, each backed by a
 * $extends-instrumented PrismaClient instance.
 *
 * Used per-domain (Users Read/Write, Notifications Read/Write).
 */
export const createDatabaseModule = <T extends ExtensibleClient>(
	clients: readonly DatabaseClientDef<T>[]
): DynamicModule => {
	const providers: FactoryProvider[] = clients.map((def) => ({
		provide: def.token,
		useFactory: async (): Promise<T> => {
			const logger = new Logger(
				typeof def.token === 'symbol' ? (def.token.description ?? 'PrismaClient') : def.token.name
			)
			const client = createExtendedPrismaClient(def.ctor, def.url(), logger)

			if (typeof client.$connect === 'function') {
				await client.$connect()
			}

			return client
		}
	}))

	@Module({
		providers,
		exports: providers.map((p) => p.provide)
	})
	class DatabaseModule {}

	return {
		module: DatabaseModule,
		providers,
		exports: providers.map((p) => p.provide)
	}
}
