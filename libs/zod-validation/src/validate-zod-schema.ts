import { ZodType } from 'zod'

export type ValidateZodSchemaResult = { errorMessage: string } | { data: unknown }

export const validateZodSchema = (
	schema: ZodType<unknown>,
	data: unknown
): ValidateZodSchemaResult => {
	const result = schema.safeParse(data)

	if (result.success) {
		return { data: result.data }
	}

	const errorMessage = result.error.issues
		.map((issue) => `\n**Param:** "${issue.path.join('.')}", **Error:** "${issue.message}"`)
		.join(', ')

	return { errorMessage }
}
