import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Observable } from 'rxjs'
import { ZodType } from 'zod'

import { validateZodSchema } from './validate-zod-schema'
import { ZOD_SCHEMA_KEY } from './zod-schema.decorator'
import { ZodValidationException } from './zod-validation.exception'

@Injectable()
export class BaseZodValidationInterceptor implements NestInterceptor {
	private readonly logger: Logger = new Logger(BaseZodValidationInterceptor.name)

	constructor(private readonly reflector: Reflector) {}

	intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
		const handler = context.getHandler()
		const schema = this.reflector.get<ZodType<unknown> | undefined>(ZOD_SCHEMA_KEY, handler)

		if (!schema) {
			return next.handle()
		}

		const request = context.switchToHttp().getRequest<{
			body?: Record<string, unknown>
			query?: Record<string, unknown>
		}>()

		if (!request?.body && !request?.query) {
			return next.handle()
		}

		const payload = { ...request.body, ...request.query }
		const result = validateZodSchema(schema, payload)

		if ('errorMessage' in result) {
			const message = `Wrong params were provided. ${result.errorMessage}`

			this.logger.error({ body: request.body, message }, 'Validation error')

			throw new ZodValidationException(message)
		}

		if (request.body) request.body = result.data as Record<string, unknown>
		if (request.query) request.query = result.data as Record<string, unknown>

		return next.handle()
	}
}
