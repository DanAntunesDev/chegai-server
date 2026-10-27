import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import type { AccessTokenPayload } from '../../src/modules/auth/auth.types';
import { TokenService } from '../../src/modules/auth/token.service';
import { MailService } from '../../src/modules/mail/mail.service';
import { StorageService } from '../../src/modules/storage/storage.service';
import { FakeMailService, FakeStorageService } from './fakes';

export interface TestApp {
  app: INestApplication;
  mail: FakeMailService;
  storage: FakeStorageService;
  tokenFor: (payload: Partial<AccessTokenPayload>) => Promise<string>;
}

export async function createTestApp(): Promise<TestApp> {
  const mail = new FakeMailService();
  const storage = new FakeStorageService();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailService)
    .useValue(mail)
    .overrideProvider(StorageService)
    .useValue(storage)
    .compile();

  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  const tokens = app.get(TokenService);

  return {
    app,
    mail,
    storage,
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
