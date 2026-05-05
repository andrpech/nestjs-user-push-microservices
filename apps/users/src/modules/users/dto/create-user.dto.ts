import { z } from 'zod'

export const CreateUserSchema = z.strictObject({
	name: z.string().min(1).max(64)
})

export type CreateUserDto = z.infer<typeof CreateUserSchema>
