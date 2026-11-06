import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentTenant } from '../auth/auth.decorators';
import type { TenantAuthContext } from '../auth/auth.types';
import {
  type ConfirmBookingInput,
  confirmBookingSchema,
  type CreateHoldInput,
  createHoldSchema,
} from './bookings.schemas';
import { BookingsService } from './bookings.service';

@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Post('holds')
  createHold(
    @CurrentTenant() auth: TenantAuthContext,
    @Body(new ZodValidationPipe(createHoldSchema)) body: CreateHoldInput,
  ) {
    return this.bookings.createHold(auth, body);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  confirm(
    @CurrentTenant() auth: TenantAuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(confirmBookingSchema)) body: ConfirmBookingInput,
  ) {
    return this.bookings.confirm(auth, id, body);
  }

  @Get(':id')
  get(@CurrentTenant() auth: TenantAuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.get(auth, id);
  }
}
