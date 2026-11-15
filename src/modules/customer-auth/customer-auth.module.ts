import { Module } from '@nestjs/common';
import { CustomerAccountService } from './customer-account.service';
import { CustomerAuthGuard } from './customer-auth.guard';
import { CustomerTokenService } from './customer-token.service';
import { PhoneVerificationService } from './phone-verification.service';

@Module({
  providers: [
    CustomerTokenService,
    PhoneVerificationService,
    CustomerAuthGuard,
    CustomerAccountService,
  ],
  exports: [
    CustomerTokenService,
    PhoneVerificationService,
    CustomerAuthGuard,
    CustomerAccountService,
  ],
})
export class CustomerAuthModule {}
