import { z } from 'zod'

export const MonolithConfigSchema = z.strictObject({
	app: z.strictObject({
		env: z.enum(['development', 'production', 'test']),
		port: z.number().int().min(1).max(65535)
	}),
	usersDb: z.strictObject({
		readUrl: z.string().min(1),
		writeUrl: z.string().min(1)
	})
})

export type MonolithConfig = z.infer<typeof MonolithConfigSchema>
