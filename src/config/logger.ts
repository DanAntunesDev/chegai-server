import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { ConfigService } from '@nestjs/config';
import type { Params } from 'nestjs-pino';
import { Env } from './env';

export function buildLoggerOptions(config: ConfigService<Env, true>): Params {
  const isDevelopment = config.get('NODE_ENV', { infer: true }) === 'development';

  return {
    pinoHttp: {
      level: config.get('LOG_LEVEL', { infer: true }),
      genReqId: (request: IncomingMessage) => {
        const header = request.headers['x-request-id'];
        return typeof header === 'string' && header.length > 0 ? header : randomUUID();
      },
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      autoLogging: {
        ignore: (request: IncomingMessage) => request.url === '/health',
      },
      transport: isDevelopment
        ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' } }
        : undefined,
    },
  };
}
