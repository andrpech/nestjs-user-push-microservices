import { DynamicModule, FactoryProvider, Logger, Module } from '@nestjs/common'

import { createExtendedPrismaClient, QueryObserver } from './create-prisma-client'

type ExtensibleClient = {
	$extends: (def: unknown) => unknown
	$connect?: () => Promise<unknown>
}

type ClientConstructor<T extends ExtensibleClient> = new (opts: { datasourceUrl: string }) => T

export type DatabaseClientDef<T extends ExtensibleClient> = {
	token: symbol | (new (...args: unknown[]) => unknown)
	ctor: ClientConstructor<T>
	url: () => string
	// Per-client observer factory. Lets apps inject their MetricsService and
	// hand back a QueryObserver without coupling libs/database-core to any
	// concrete metrics library.
	inject?: (symbol | (new (...args: unknown[]) => unknown))[]
	observerFactory?: (...deps: unknown[]) => QueryObserver
}

/**
 * Build a NestJS module exporting the given DI tokens, each backed by a
 * $extends-instrumented PrismaClient instance.
 */
export const createDatabaseModule = <T extends ExtensibleClient>(
	clients: readonly DatabaseClientDef<T>[]
): DynamicModule => {
	const providers: FactoryProvider[] = clients.map((def) => ({
		provide: def.token,
		inject: def.inject ?? [],
		useFactory: async (...deps: unknown[]): Promise<T> => {
			const logger = new Logger(
				typeof def.token === 'symbol' ? (def.token.description ?? 'PrismaClient') : def.token.name
			)
			const observer = def.observerFactory?.(...deps)
			const client = createExtendedPrismaClient(def.ctor, def.url(), logger, observer)

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
