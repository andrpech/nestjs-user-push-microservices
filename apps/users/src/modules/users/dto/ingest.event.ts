import { z } from 'zod'

// Producer-side mirror of the notifier's IngestEventSchema. Each app owns its
// view of inter-service contracts. Updating one without the other is a code
// review item.
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
