export interface VerificationMessage {
  tenantId: string;
  tenantName: string;
  phone: string;
  code: string;
}

export abstract class CustomerMessenger {
  abstract sendVerificationCode(message: VerificationMessage): Promise<void>;
}
