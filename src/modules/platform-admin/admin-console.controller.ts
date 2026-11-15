import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentAuth, PlatformAdminOnly } from '../auth/auth.decorators';
import type { AuthContext } from '../auth/auth.types';
import {
  type CreateUserInput,
  createUserSchema,
  type ListUsersInput,
  listUsersSchema,
  type MetricsQuery,
  metricsQuerySchema,
  type UpdateUserInput,
  updateUserSchema,
} from './admin-console.schemas';
import { AdminConsoleService } from './admin-console.service';

@Controller('admin')
@PlatformAdminOnly()
export class AdminConsoleController {
  constructor(private readonly console: AdminConsoleService) {}

  @Get('metrics')
  metrics(@Query(new ZodValidationPipe(metricsQuerySchema)) query: MetricsQuery) {
    return this.console.metrics(query);
  }

  @Get('users')
  listUsers(@Query(new ZodValidationPipe(listUsersSchema)) query: ListUsersInput) {
    return this.console.listUsers(query);
  }

  @Post('users')
  createUser(@Body(new ZodValidationPipe(createUserSchema)) body: CreateUserInput) {
    return this.console.createUser(body);
  }

  @Patch('users/:id')
  updateUser(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) body: UpdateUserInput,
  ) {
    return this.console.updateUser(auth.userId, id, body);
  }
}
