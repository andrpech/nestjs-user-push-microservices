import { defineConfig } from 'vitest/config'

// E2e tests assume the full compose stack is running (`make e2e-up`). They
// connect to Postgres on localhost:5432 and to the users service on
// localhost:3000 (nginx-fronted). Timeouts are generous to absorb the
// notifier's scheduled_for delay + cron tick interval.
export default defineConfig({
	test: {
		include: ['test/e2e/**/*.test.ts'],
		exclude: ['**/node_modules/**', '**/dist/**', '**/generated/**'],
		testTimeout: 60_000,
		hookTimeout: 60_000,
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
