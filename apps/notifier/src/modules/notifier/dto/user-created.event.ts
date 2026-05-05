import { z } from 'zod'

// Mirror of the producer-side contract in apps/monolith/src/modules/users/dto/user-created.event.ts.
// Duplicated intentionally — after the phase 7 split each app owns its own copy.
export const UserCreatedEventSchema = z.strictObject({
	userId: z.string().min(1),
	name: z.string().min(1)
})

export type UserCreatedEvent = z.infer<typeof UserCreatedEventSchema>
