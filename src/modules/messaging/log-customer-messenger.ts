import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/env';
import { CustomerMessenger, type VerificationMessage } from './customer-messenger';

@Injectable()
export class LogCustomerMessenger extends CustomerMessenger {
  private readonly logger = new Logger('CustomerMessenger');

  constructor(private readonly config: ConfigService<Env, true>) {
    super();
  }

  sendVerificationCode(message: VerificationMessage): Promise<void> {
    if (this.config.get('NODE_ENV', { infer: true }) === 'production') {
      throw new AppError('MESSAGING_UNAVAILABLE', 'WhatsApp delivery is not configured yet', 503);
    }
    this.logger.warn(`verification code for ${message.phone}: ${message.code}`);
    return Promise.resolve();
  }
}
