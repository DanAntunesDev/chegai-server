import { Module } from '@nestjs/common';
import { CustomerAuthGuard } from './customer-auth.guard';
import { CustomerTokenService } from './customer-token.service';
import { PhoneVerificationService } from './phone-verification.service';

@Module({
  providers: [CustomerTokenService, PhoneVerificationService, CustomerAuthGuard],
  exports: [CustomerTokenService, PhoneVerificationService, CustomerAuthGuard],
})
export class CustomerAuthModule {}
