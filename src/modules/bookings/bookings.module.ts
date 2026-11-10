import { Module } from '@nestjs/common';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { BookingsSweeper } from './bookings.sweeper';

@Module({
  controllers: [BookingsController],
  providers: [BookingsService, BookingsSweeper],
  exports: [BookingsService],
})
export class BookingsModule {}
