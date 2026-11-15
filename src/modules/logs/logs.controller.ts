import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { PlatformAdminOnly } from '../auth/auth.decorators';
import {
  type AuditLogsQuery,
  auditLogsQuerySchema,
  type RequestLogsQuery,
  requestLogsQuerySchema,
} from './logs.schemas';
import { LogsService } from './logs.service';

@Controller('admin/logs')
@PlatformAdminOnly()
export class LogsController {
  constructor(private readonly logs: LogsService) {}

  @Get('requests')
  requests(@Query(new ZodValidationPipe(requestLogsQuerySchema)) query: RequestLogsQuery) {
    return this.logs.requests(query);
  }

  @Get('requests/:id')
  request(@Param('id', ParseUUIDPipe) id: string) {
    return this.logs.request(id);
  }

  @Get('audit')
  audits(@Query(new ZodValidationPipe(auditLogsQuerySchema)) query: AuditLogsQuery) {
    return this.logs.audits(query);
  }
}
