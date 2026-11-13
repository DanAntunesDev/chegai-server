import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { setupOpenApi } from './docs/openapi';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  const config = configureApp(app);
  if (config.get('API_DOCS_ENABLED', { infer: true })) {
    setupOpenApi(app);
  }

  await app.listen(config.get('PORT', { infer: true }));
}

void bootstrap();
