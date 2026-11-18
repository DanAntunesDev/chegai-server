import { Global, Module } from '@nestjs/common';
import { CustomerMessenger } from './customer-messenger';
import { LogCustomerMessenger } from './log-customer-messenger';

@Global()
@Module({
  providers: [{ provide: CustomerMessenger, useClass: LogCustomerMessenger }],
  exports: [CustomerMessenger],
})
export class MessagingModule {}
