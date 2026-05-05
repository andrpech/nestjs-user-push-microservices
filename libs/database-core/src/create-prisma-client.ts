import { Logger } from '@nestjs/common'

// PrismaClient is provided by each consumer at call site (their own generated client).
// We accept any constructor that takes { datasourceUrl } and returns an instance with $extends.
type ExtensibleClient = {
	$extends: (def: unknown) => unknown
}

type ClientConstructor<T extends ExtensibleClient> = new (opts: { datasourceUrl: string }) => T

export type PrismaQueryEvent = {
	model: string
	operation: string
	durationMs: number
}

export type QueryObserver = (event: PrismaQueryEvent) => void

/**
 * Wraps a generated PrismaClient with $extends-based instrumentation.
 *
 * Phase 2: pino query logging at debug (>500ms → info).
 * Phase 8: optional QueryObserver hook for metrics — apps pass in their MetricsService observer.
 */
export const createExtendedPrismaClient = <T extends ExtensibleClient>(
	Ctor: ClientConstructor<T>,
	url: string,
	logger: Logger,
	observer?: QueryObserver
): T => {
	if (!url) {
		throw new Error('Prisma client URL is empty')
	}

	const baseClient = new Ctor({ datasourceUrl: url })

	const extended = baseClient.$extends({
		query: {
			$allOperations: ({
				operation,
				model,
				args,
				query
			}: {
				operation: string
				model?: string
				args: unknown
				query: (args: unknown) => Promise<unknown>
			}): Promise<unknown> => {
				const start = Date.now()

				return query(args).finally(() => {
					const duration = Date.now() - start
					const payload = { model, operation, duration }

					if (duration > 500) {
						logger.log(`prisma slow query ${JSON.stringify(payload)}`)
					} else {
						logger.debug?.(`prisma query ${JSON.stringify(payload)}`)
					}

					observer?.({ model: model ?? 'raw', operation, durationMs: duration })
				})
			}
		}
	})

	return extended as T
}
