import { z } from 'zod'

// Generic ingest envelope. Producers anywhere publish to `notifications.ingest`
// with this shape. `params` is opaque at the envelope level — the IngestConsumer
// looks up TYPE_CATALOG[type].paramsSchema and validates against it after the
// envelope itself parses cleanly.
export const IngestEventSchema = z.strictObject({
	type: z.string().min(1),
	sourceEventId: z.string().min(1),
	scheduledFor: z.iso.datetime().optional(),
	recipient: z.strictObject({
		userId: z.string().min(1).optional(),
		email: z.email().optional(),
		phone: z.string().min(1).optional(),
		pushToken: z.string().min(1).optional()
	}),
	params: z.unknown()
})

export type IngestEvent = z.infer<typeof IngestEventSchema>
export type IngestRecipient = IngestEvent['recipient']
