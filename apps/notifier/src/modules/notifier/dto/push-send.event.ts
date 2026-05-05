import { z } from 'zod'

export const PushSendEventSchema = z.strictObject({
	userId: z.string().min(1),
	name: z.string().min(1),
	notificationId: z.string().min(1)
})

export type PushSendEvent = z.infer<typeof PushSendEventSchema>
