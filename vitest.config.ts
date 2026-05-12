import { defineConfig } from 'vitest/config'

// Tests live alongside the code they cover, under `**/__tests__/**/*.test.ts`.
// Path aliases mirror tsconfig.json. DB-dependent tests gate themselves on
// RUN_DB_TESTS=1 (see notification.state-machine.test.ts and
// users-outbox.repository.test.ts) so a bare `make test` only exercises pure
// modules.
export default defineConfig({
	test: {
		include: ['**/__tests__/**/*.test.ts'],
		exclude: ['**/node_modules/**', '**/dist/**', '**/generated/**'],
		testTimeout: 15_000,
		hookTimeout: 15_000,
		environment: 'node'
	},
	resolve: {
		alias: {
			'@app/common': new URL('libs/common/src/index.ts', import.meta.url).pathname,
			'@app/rmq': new URL('libs/rmq/src/index.ts', import.meta.url).pathname,
			'@app/zod-validation': new URL('libs/zod-validation/src/index.ts', import.meta.url).pathname,
			'@app/metrics': new URL('libs/metrics/src/index.ts', import.meta.url).pathname,
			'@app/database-core': new URL('libs/database-core/src/index.ts', import.meta.url).pathname,
			'@app/tracing': new URL('libs/tracing/src/index.ts', import.meta.url).pathname
		}
	}
})
