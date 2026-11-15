import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentAuth, PlatformAdminOnly } from '../auth/auth.decorators';
import type { AuthContext } from '../auth/auth.types';
import { type IntegrationKey, integrationKeySchema } from '../integrations/integration-catalog';
import {
  type TenantPaymentsInput,
  tenantPaymentsSchema,
  type UpdateWebhookEndpointInput,
  updateWebhookEndpointSchema,
  type WebhookEndpointInput,
  webhookEndpointSchema,
} from './admin-integrations.schemas';
import { AdminIntegrationsService } from './admin-integrations.service';

@Controller('admin')
@PlatformAdminOnly()
export class AdminIntegrationsController {
  constructor(private readonly integrations: AdminIntegrationsService) {}

  @Get('integrations')
  list() {
    return this.integrations.list();
  }

  @Put('integrations/:key')
  save(
    @CurrentAuth() auth: AuthContext,
    @Param('key', new ZodValidationPipe(integrationKeySchema)) key: IntegrationKey,
    @Body() body: unknown,
  ) {
    return this.integrations.save(key, body, auth.userId);
  }

  @Post('integrations/:key/test')
  @HttpCode(200)
  test(@Param('key', new ZodValidationPipe(integrationKeySchema)) key: IntegrationKey) {
    return this.integrations.test(key);
  }

  @Get('webhooks')
  listWebhooks() {
    return this.integrations.listWebhooks();
  }

  @Post('webhooks')
  createWebhook(@Body(new ZodValidationPipe(webhookEndpointSchema)) body: WebhookEndpointInput) {
    return this.integrations.createWebhook(body);
  }

  @Patch('webhooks/:id')
  updateWebhook(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateWebhookEndpointSchema)) body: UpdateWebhookEndpointInput,
  ) {
    return this.integrations.updateWebhook(id, body);
  }

  @Post('webhooks/:id/rotate-secret')
  @HttpCode(200)
  rotateSecret(@Param('id', ParseUUIDPipe) id: string) {
    return this.integrations.rotateSecret(id);
  }

  @Delete('webhooks/:id')
  deleteWebhook(@Param('id', ParseUUIDPipe) id: string) {
    return this.integrations.deleteWebhook(id);
  }

  @Get('webhooks/:id/deliveries')
  deliveries(@Param('id', ParseUUIDPipe) id: string) {
    return this.integrations.deliveries(id);
  }

  @Post('webhooks/:id/test')
  @HttpCode(200)
  ping(@Param('id', ParseUUIDPipe) id: string) {
    return this.integrations.ping(id);
  }

  @Get('tenants/:id/payments')
  tenantPayments(@Param('id', ParseUUIDPipe) id: string) {
    return this.integrations.tenantPayments(id);
  }

  @Put('tenants/:id/payments')
  saveTenantPayments(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(tenantPaymentsSchema)) body: TenantPaymentsInput,
  ) {
    return this.integrations.saveTenantPayments(id, body);
  }
}
