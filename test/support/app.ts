import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { PaymentGateway } from '../../src/modules/billing/payment-gateway';
import { configureApp } from '../../src/app.setup';
import type { AccessTokenPayload } from '../../src/modules/auth/auth.types';
import { TokenService } from '../../src/modules/auth/token.service';
import { MailService } from '../../src/modules/mail/mail.service';
import { CustomerMessenger } from '../../src/modules/messaging/customer-messenger';
import { StorageService } from '../../src/modules/storage/storage.service';
import {
  FakeCustomerMessenger,
  FakeMailService,
  FakePaymentGateway,
  FakeStorageService,
} from './fakes';

export interface TestApp {
  app: INestApplication;
  mail: FakeMailService;
  storage: FakeStorageService;
  messenger: FakeCustomerMessenger;
  payments: FakePaymentGateway;
  tokenFor: (payload: Partial<AccessTokenPayload>) => Promise<string>;
}

export async function createTestApp(): Promise<TestApp> {
  const mail = new FakeMailService();
  const storage = new FakeStorageService();
  const messenger = new FakeCustomerMessenger();
  const payments = new FakePaymentGateway();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailService)
    .useValue(mail)
    .overrideProvider(StorageService)
    .useValue(storage)
    .overrideProvider(CustomerMessenger)
    .useValue(messenger)
    .overrideProvider(PaymentGateway)
    .useValue(payments)
    .compile();

  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  const tokens = app.get(TokenService);

  return {
    app,
    mail,
    storage,
    messenger,
    payments,
    tokenFor: (payload) =>
      tokens.signAccessToken({
        sub: '00000000-0000-7000-8000-000000000000',
        tid: null,
        role: null,
        perms: [],
        adm: false,
        mfa: false,
        ...payload,
      }),
  };
}
