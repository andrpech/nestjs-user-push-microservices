import { describe, expect, it } from 'vitest'

import { computeBackoffMs, createTypeCatalog } from '../type-catalog'

describe('TypeCatalog', () => {
	describe('createTypeCatalog', () => {
		it('exposes USER_WELCOME entry by default', () => {
			const catalog = createTypeCatalog()
			expect(catalog.isKnownType('USER_WELCOME')).toBe(true)
			expect(catalog.entryFor('USER_WELCOME')).toBeDefined()
			expect(catalog.keys()).toEqual(['USER_WELCOME'])
		})

		it('rejects unknown type', () => {
			const catalog = createTypeCatalog()
			expect(catalog.isKnownType('PASSWORD_CHANGED')).toBe(false)
			expect(catalog.entryFor('PASSWORD_CHANGED')).toBeUndefined()
		})

		it('honors per-type delay override', () => {
			const catalog = createTypeCatalog({ userWelcomeDelayMs: 60_000 })
			const entry = catalog.entryFor('USER_WELCOME')
			expect(entry?.defaultDelayMs).toBe(60_000)
		})

		it('honors per-type maxAttempts override', () => {
			const catalog = createTypeCatalog({ userWelcomeMaxAttempts: 3 })
			const entry = catalog.entryFor('USER_WELCOME')
			expect(entry?.retryPolicy.maxAttempts).toBe(3)
		})

		it('uses defaults when overrides omitted', () => {
			const catalog = createTypeCatalog({})
			const entry = catalog.entryFor('USER_WELCOME')
			expect(entry?.defaultDelayMs).toBe(30_000)
			expect(entry?.retryPolicy.maxAttempts).toBe(5)
			expect(entry?.channel).toBe('webhook')
		})
	})

	describe('USER_WELCOME paramsSchema', () => {
		const entry = createTypeCatalog().entryFor('USER_WELCOME')

		it('accepts a valid payload', () => {
			const parsed = entry!.paramsSchema.parse({ userId: '01J', name: 'Andrii' })
			expect(parsed).toEqual({ userId: '01J', name: 'Andrii' })
		})

		it('rejects empty name', () => {
			expect(() => entry!.paramsSchema.parse({ userId: '01J', name: '' })).toThrow()
		})

		it('rejects missing userId', () => {
			expect(() => entry!.paramsSchema.parse({ name: 'Andrii' })).toThrow()
		})

		it('rejects extra fields', () => {
			expect(() => entry!.paramsSchema.parse({ userId: '01J', name: 'A', extra: 'no' })).toThrow()
		})
	})

	describe('USER_WELCOME render', () => {
		const entry = createTypeCatalog().entryFor('USER_WELCOME')

		it('produces the expected body shape', () => {
			const { body } = entry!.render({ userId: '01J', name: 'Andrii' })
			expect(body).toEqual({ userId: '01J', name: 'Andrii' })
		})
	})

	describe('computeBackoffMs', () => {
		it('returns baseMs for attempts=1 on exponential', () => {
			const policy = {
				maxAttempts: 5,
				backoff: 'exponential' as const,
				baseMs: 1_000,
				jitter: 0
			}
			expect(computeBackoffMs(policy, 1)).toBe(1_000)
		})

		it('doubles on each subsequent attempt for exponential', () => {
			const policy = {
				maxAttempts: 5,
				backoff: 'exponential' as const,
				baseMs: 1_000,
				jitter: 0
			}
			expect(computeBackoffMs(policy, 2)).toBe(2_000)
			expect(computeBackoffMs(policy, 3)).toBe(4_000)
			expect(computeBackoffMs(policy, 4)).toBe(8_000)
		})

		it('returns baseMs constant for fixed', () => {
			const policy = { maxAttempts: 5, backoff: 'fixed' as const, baseMs: 500, jitter: 0 }
			expect(computeBackoffMs(policy, 1)).toBe(500)
			expect(computeBackoffMs(policy, 4)).toBe(500)
		})

		it('treats attempts<=1 as the first attempt (no negative exponent)', () => {
			const policy = {
				maxAttempts: 5,
				backoff: 'exponential' as const,
				baseMs: 1_000,
				jitter: 0
			}
			expect(computeBackoffMs(policy, 0)).toBe(1_000)
			expect(computeBackoffMs(policy, -1)).toBe(1_000)
		})

		it('applies jitter when positive (within bounds)', () => {
			const policy = {
				maxAttempts: 5,
				backoff: 'fixed' as const,
				baseMs: 1_000,
				jitter: 0.2
			}
			for (let i = 0; i < 50; i++) {
				const v = computeBackoffMs(policy, 1)
				expect(v).toBeGreaterThanOrEqual(800)
				expect(v).toBeLessThanOrEqual(1200)
			}
		})
	})
})
