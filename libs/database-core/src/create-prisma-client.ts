import { Logger } from '@nestjs/common'

// PrismaClient is provided by each consumer at call site (their own generated client).
// We accept any constructor that takes { datasourceUrl } and returns an instance with $extends.
type ExtensibleClient = {
	$extends: (def: unknown) => unknown
}

type ClientConstructor<T extends ExtensibleClient> = new (opts: { datasourceUrl: string }) => T

/**
 * Wraps a generated PrismaClient with $extends-based instrumentation.
 *
 * Phase 2: pino query logging at debug (>500ms → info).
 * Phase 4: replaced with OTel auto-instrumentation.
 *
 * The cast back to T is sound because we add no new methods via $extends —
 * only query-side instrumentation. If consumers ever add methods via this
 * factory, the cast becomes lossy and needs revisiting.
 */
export const createExtendedPrismaClient = <T extends ExtensibleClient>(
	Ctor: ClientConstructor<T>,
	url: string,
	logger: Logger
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
				})
			}
		}
	})

	return extended as T
}
