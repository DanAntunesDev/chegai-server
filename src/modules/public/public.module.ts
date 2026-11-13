import { Module } from '@nestjs/common';
import { AvailabilityModule } from '../availability/availability.module';
import { BookingsModule } from '../bookings/bookings.module';
import { CustomerAuthModule } from '../customer-auth/customer-auth.module';
import { PublicBookingController } from './public-booking.controller';
import { PublicTenantService } from './public-tenant.service';
import { PublicController } from './public.controller';

@Module({
  imports: [AvailabilityModule, BookingsModule, CustomerAuthModule],
  controllers: [PublicController, PublicBookingController],
  providers: [PublicTenantService],
})
export class PublicModule {}
