import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { LogsController } from './logs.controller';
import { LogsService } from './logs.service';
import { RequestLogMiddleware } from './request-log.middleware';

@Module({
  controllers: [LogsController],
  providers: [LogsService, RequestLogMiddleware],
})
export class LogsModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLogMiddleware).forRoutes('*path');
  }
}
