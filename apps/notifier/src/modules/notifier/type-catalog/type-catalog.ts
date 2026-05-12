import { z, ZodType } from 'zod'

export type Channel = 'webhook' | 'email' | 'sms'

export type RetryPolicy = {
	maxAttempts: number
	backoff: 'exponential' | 'fixed'
	baseMs: number
	jitter: number
}

export type TypeCatalogEntry<TParams = unknown> = {
	paramsSchema: ZodType<TParams>
	render: (params: TParams) => { body: Record<string, unknown> }
	channel: Channel
	defaultDelayMs: number
	retryPolicy: RetryPolicy
}

export const USER_WELCOME_PARAMS_SCHEMA = z.strictObject({
	userId: z.string().min(1),
	name: z.string().min(1)
})

export type UserWelcomeParams = z.infer<typeof USER_WELCOME_PARAMS_SCHEMA>

export type TypeCatalogOverrides = {
	userWelcomeDelayMs?: number
	userWelcomeMaxAttempts?: number
}

export interface TypeCatalog {
	isKnownType(type: string): boolean
	entryFor(type: string): TypeCatalogEntry | undefined
	keys(): readonly string[]
}

const userWelcomeEntry = (
	overrides: TypeCatalogOverrides
): TypeCatalogEntry<UserWelcomeParams> => ({
	paramsSchema: USER_WELCOME_PARAMS_SCHEMA,
	render: (params): { body: Record<string, unknown> } => ({
		body: { userId: params.userId, name: params.name }
	}),
	channel: 'webhook',
	defaultDelayMs: overrides.userWelcomeDelayMs ?? 30_000,
	retryPolicy: {
		maxAttempts: overrides.userWelcomeMaxAttempts ?? 5,
		backoff: 'exponential',
		baseMs: 1_000,
		jitter: 0
	}
})

export const TYPE_CATALOG_TOKEN = Symbol('TYPE_CATALOG')

export const createTypeCatalog = (overrides: TypeCatalogOverrides = {}): TypeCatalog => {
	const entries: Record<string, TypeCatalogEntry> = {
		USER_WELCOME: userWelcomeEntry(overrides) as TypeCatalogEntry
	}
	const keys = Object.keys(entries)
	return {
		isKnownType: (type): boolean => Object.hasOwn(entries, type),
		entryFor: (type): TypeCatalogEntry | undefined => entries[type],
		keys: (): readonly string[] => keys
	}
}

// Pure backoff helper. Lives in the catalog module because the policy shape is
// catalog-owned; the consumer applies it to an `attempts` count without owning
// the math itself.
export const computeBackoffMs = (policy: RetryPolicy, attempts: number): number => {
	const base =
		policy.backoff === 'exponential'
			? policy.baseMs * 2 ** Math.max(0, attempts - 1)
			: policy.baseMs
	if (policy.jitter <= 0) return Math.max(0, Math.floor(base))
	const variance = base * policy.jitter
	const jittered = base + (Math.random() - 0.5) * 2 * variance
	return Math.max(0, Math.floor(jittered))
}
