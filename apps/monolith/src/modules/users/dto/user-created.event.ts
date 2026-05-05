import { z } from 'zod'

export const UserCreatedEventSchema = z.strictObject({
	userId: z.string().min(1),
	name: z.string().min(1)
})

export type UserCreatedEvent = z.infer<typeof UserCreatedEventSchema>
