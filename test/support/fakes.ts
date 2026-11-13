import type {
  CreatedCharge,
  GatewayCharge,
  GatewayCustomer,
} from '../../src/modules/billing/payment-gateway';
import type {
  CustomerMessenger,
  VerificationMessage,
} from '../../src/modules/messaging/customer-messenger';
import type { MailMessage, MailService } from '../../src/modules/mail/mail.service';
import type { StoredFile, StorageService } from '../../src/modules/storage/storage.service';

export class FakeMailService implements MailService {
  readonly sent: MailMessage[] = [];
  failNext = false;

  send(message: MailMessage): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('smtp unavailable'));
    }
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

export const FAKE_WEBHOOK_TOKEN = 'test-webhook-token-123';

export class FakePaymentGateway {
  readonly name = 'asaas';
  readonly customers: GatewayCustomer[] = [];
  readonly charges: (GatewayCharge & { id: string })[] = [];

  createCustomer(customer: GatewayCustomer): Promise<string> {
    this.customers.push(customer);
    return Promise.resolve(`cus_${this.customers.length}`);
  }

  createCharge(charge: GatewayCharge): Promise<CreatedCharge> {
    const id = `pay_${this.charges.length + 1}_${charge.reference.slice(0, 8)}`;
    this.charges.push({ ...charge, id });
    return Promise.resolve({ id, paymentUrl: `https://sandbox.test/i/${id}` });
  }

  cancelCharge(): Promise<void> {
    return Promise.resolve();
  }

  verifyWebhook(token: string | undefined): boolean {
    return token === FAKE_WEBHOOK_TOKEN;
  }
}
