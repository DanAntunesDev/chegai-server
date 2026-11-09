import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentTenant } from '../auth/auth.decorators';
import type { TenantAuthContext } from '../auth/auth.types';
import {
  type CancelBookingInput,
  cancelBookingSchema,
  type ConfirmBookingInput,
  confirmBookingSchema,
  type CreateHoldInput,
  createHoldSchema,
  type ListBookingsQuery,
  listBookingsSchema,
  type RescheduleBookingInput,
  rescheduleBookingSchema,
} from './bookings.schemas';
import { BookingsService } from './bookings.service';

@Controller('bookings')
export class BookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get()
  list(
    @CurrentTenant() auth: TenantAuthContext,
    @Query(new ZodValidationPipe(listBookingsSchema)) query: ListBookingsQuery,
  ) {
    return this.bookings.list(auth, query);
  }

  @Post('holds')
  createHold(
    @CurrentTenant() auth: TenantAuthContext,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(createHoldSchema)) body: CreateHoldInput,
  ) {
    return this.idempotency.run(
      { tenantId: auth.tenantId, key, scope: 'bookings.hold', payload: body },
      () => this.bookings.createHold(auth, body),
    );
  }

  @Post(':id/confirm')
  @HttpCode(200)
  confirm(
    @CurrentTenant() auth: TenantAuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(confirmBookingSchema)) body: ConfirmBookingInput,
  ) {
    return this.idempotency.run(
      { tenantId: auth.tenantId, key, scope: `bookings.confirm:${id}`, payload: body },
      () => this.bookings.confirm(auth, id, body),
    );
  }

  @Post(':id/reschedule')
  @HttpCode(200)
  reschedule(
    @CurrentTenant() auth: TenantAuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(rescheduleBookingSchema)) body: RescheduleBookingInput,
  ) {
    return this.idempotency.run(
      { tenantId: auth.tenantId, key, scope: `bookings.reschedule:${id}`, payload: body },
      () => this.bookings.reschedule(auth, id, body),
    );
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @CurrentTenant() auth: TenantAuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(cancelBookingSchema)) body: CancelBookingInput,
  ) {
    return this.bookings.cancel(auth, id, body);
  }

  @Post(':id/check-in')
  @HttpCode(200)
  checkIn(@CurrentTenant() auth: TenantAuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.checkIn(auth, id);
  }

  @Post(':id/complete')
  @HttpCode(200)
  complete(@CurrentTenant() auth: TenantAuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.complete(auth, id);
  }

  @Post(':id/no-show')
  @HttpCode(200)
  noShow(@CurrentTenant() auth: TenantAuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.markNoShow(auth, id);
  }

  @Get(':id/events')
  events(@CurrentTenant() auth: TenantAuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.events(auth, id);
  }

  @Get(':id')
  get(@CurrentTenant() auth: TenantAuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.get(auth, id);
  }
}
