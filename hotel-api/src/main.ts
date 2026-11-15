import { BaseExceptionFilter, HttpAdapterHost, NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { ConsoleLogger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { writeFileSync } from 'fs';
import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { ArgumentsHost, Catch, HttpException, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';


// ---- logging ----
const httpLogger = new Logger('HTTP');

// Access log for every request: id, method, url, status, duration, user.
// Business events (booking created, login failed, ...) are logged inside the services.
function httpLoggerMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.originalUrl.startsWith('/api-docs')) return next(); // skip Swagger UI assets

  const start = process.hrtime.bigint();
  const requestId = randomUUID().slice(0, 8);
  (req as any).id = requestId; // also used by the exception filter

  res.on('finish', () => {
    const ms = (Number(process.hrtime.bigint() - start) / 1e6).toFixed(1);
    const user = (req as any).user; // set by JwtStrategy after login
    const who = user ? `user=${user.id}(${user.role})` : 'user=guest';
    const status = res.statusCode;

    httpLogger.log(`[${requestId}] ${req.method} ${req.originalUrl} ${status} ${ms}ms ${who} ip=${req.ip}`);
  });

  next();
}

// Logs every error, then lets Nest build the normal response (same bodies and status codes as before).
// 4xx (invalid data, not found, no permission) -> warn, 5xx / unexpected errors (DB down, bug) -> error
@Catch()
class AllExceptionsFilter extends BaseExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() === 'http') {
      const req = host.switchToHttp().getRequest();
      const id = req.id ? `[${req.id}] ` : '';
      const where = `${req.method} ${req.originalUrl}`;

      if (exception instanceof HttpException) {
        const status = exception.getStatus();
        const body = exception.getResponse();
        const raw = typeof body === 'string' ? body : ((body as any).message ?? exception.message);
        const text = Array.isArray(raw) ? raw.join('; ') : raw;

        if (status >= 500) this.logger.error(`${id}${where} -> ${status} ${text}`, exception.stack);
        else this.logger.warn(`${id}${where} -> ${status} ${text}`);
      } else {
        // Unexpected error: Nest itself prints the stack trace, we add which request caused it
        const err = exception as Error;
        this.logger.error(`${id}${where} -> 500 ${err?.message ?? 'Unknown error'}`);
      }
    }

    super.catch(exception, host);
  }
}
// ---- end logging ----

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new ConsoleLogger({
      prefix: 'nest-lab',
      logLevels:
        process.env.NODE_ENV === 'production'
          ? ['error', 'warn', 'log']
          : ['error', 'warn', 'log', 'debug', 'verbose'],
    }),
  });

  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads',
  });

  // Logging: access log for every request, error log for every exception
  app.use(httpLoggerMiddleware);
  app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost).httpAdapter));

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Swagger / OpenAPI docs
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Hotel Booking API')
    .setDescription(
      [
        'REST API for searching rooms, managing bookings and administering hotel data.',
        '',
        'How to authorize: call POST /auth/login, copy the access_token, click Authorize and paste it.',
        '',
        'Rate limiting:',
        '- 100 requests per minute per client.',
        '- Exceeding the limit returns 429 Too Many Requests.',
      ].join('\n'),
    )
    .setVersion('1.0.0')
    .addTag('health')
    .addTag('auth')
    .addTag('users')
    .addTag('rooms')
    .addTag('bookings')
    .addTag('notifications')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Use: Authorization: Bearer <access_token>',
        in: 'header',
      },
      'access-token', // Security name used in @ApiBearerAuth('access-token')
    )
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api-docs', app, swaggerDocument, {
    swaggerOptions: { persistAuthorization: true },
  });

  // Save the OpenAPI spec file for submission (skipped in production / read-only containers)
  if (process.env.NODE_ENV !== 'production') {
    try {
      writeFileSync(join(process.cwd(), 'openapi.json'), JSON.stringify(swaggerDocument, null, 2));
    } catch { /* ignore */ }
  }

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  new Logger('Bootstrap').log(`API running on port ${port} - Swagger UI at /api-docs`);
}
bootstrap();