import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { SmtpMailService } from './smtp-mail.service';

@Global()
@Module({
  providers: [{ provide: MailService, useClass: SmtpMailService }],
  exports: [MailService],
})
export class MailModule {}
