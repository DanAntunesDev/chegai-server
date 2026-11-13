import { Controller, Get, Query } from '@nestjs/common';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentTenant, RequirePermissions } from '../auth/auth.decorators';
import type { TenantAuthContext } from '../auth/auth.types';
import { type SummaryQuery, summaryQuerySchema } from './analytics.schemas';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @RequirePermissions('analytics.view')
  @Get('summary')
  summary(
    @CurrentTenant() auth: TenantAuthContext,
    @Query(new ZodValidationPipe(summaryQuerySchema)) query: SummaryQuery,
  ) {
    return this.analytics.summary(auth, query);
  }
}
