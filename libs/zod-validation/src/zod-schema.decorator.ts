import { SetMetadata } from '@nestjs/common'
import { ZodType } from 'zod'

export const ZOD_SCHEMA_KEY = 'zodSchema'

export const ZodSchema = (schema: ZodType<unknown>): MethodDecorator =>
	SetMetadata(ZOD_SCHEMA_KEY, schema)
