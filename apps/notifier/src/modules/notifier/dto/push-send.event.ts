import { z } from 'zod'

// Slim send-work message. The send consumer reads the rest of what it needs
// (recipient, params, channel, type) from the notification row by id — the
// row is the source of truth, the message carries only the pointer.
export const PushSendEventSchema = z.strictObject({
	notificationId: z.string().min(1)
})

export type PushSendEvent = z.infer<typeof PushSendEventSchema>
