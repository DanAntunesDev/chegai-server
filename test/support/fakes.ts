import type {
  CustomerMessenger,
  VerificationMessage,
} from '../../src/modules/messaging/customer-messenger';
import type { MailMessage, MailService } from '../../src/modules/mail/mail.service';
import type { StoredFile, StorageService } from '../../src/modules/storage/storage.service';

export class FakeMailService implements MailService {
  readonly sent: MailMessage[] = [];

  send(message: MailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }
}

export class FakeStorageService implements StorageService {
  readonly files = new Map<string, { body: Buffer; contentType: string }>();

  putPublic(key: string, body: Buffer, contentType: string): Promise<StoredFile> {
    this.files.set(key, { body, contentType });
    return Promise.resolve({ key, url: `https://cdn.test/${key}` });
  }
}

export class FakeCustomerMessenger implements CustomerMessenger {
  readonly codes: VerificationMessage[] = [];

  sendVerificationCode(message: VerificationMessage): Promise<void> {
    this.codes.push(message);
    return Promise.resolve();
  }

  lastCodeFor(phone: string): string {
    const found = this.codes.filter((message) => message.phone === phone).at(-1);
    if (!found) {
      throw new Error(`no code sent to ${phone}`);
    }
    return found.code;
  }
}
