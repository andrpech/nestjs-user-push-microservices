import { z } from 'zod'

// ULID = 26 chars, Crockford's base32 (no I/L/O/U). The pattern matches what
// `@app/common/ulid` produces; we reject anything else with 400.
const UlidSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, {
	message: 'must be a 26-char ULID'
})

export const GetNotificationParamSchema = z.strictObject({
	id: UlidSchema
})

export type GetNotificationParam = z.infer<typeof GetNotificationParamSchema>

export const ListNotificationsQuerySchema = z.strictObject({
	status: z.enum(['PENDING', 'PROCESSING', 'SENT', 'FAILED']).optional(),
	limit: z.coerce.number().int().min(1).max(1000).default(100),
	cursor: UlidSchema.optional()
})

export type ListNotificationsQuery = z.infer<typeof ListNotificationsQuerySchema>
