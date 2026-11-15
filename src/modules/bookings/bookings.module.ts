import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { BookingPaymentsController } from './booking-payments.controller';
import { BookingPaymentsService } from './booking-payments.service';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { BookingsSweeper } from './bookings.sweeper';

@Module({
  imports: [BillingModule],
  controllers: [BookingPaymentsController, BookingsController],
  providers: [BookingsService, BookingPaymentsService, BookingsSweeper],
  exports: [BookingsService, BookingPaymentsService],
})
export class BookingsModule {}
