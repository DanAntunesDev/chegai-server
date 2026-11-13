export interface GatewayCustomer {
  name: string;
  document: string | null;
  email: string;
  phone: string | null;
  reference: string;
}

export interface GatewayCharge {
  customerId: string;
  amountCents: number;
  dueDate: string;
  description: string;
  reference: string;
}

export interface CreatedCharge {
  id: string;
  paymentUrl: string | null;
}

export abstract class PaymentGateway {
  abstract readonly name: string;
  abstract createCustomer(customer: GatewayCustomer): Promise<string>;
  abstract createCharge(charge: GatewayCharge): Promise<CreatedCharge>;
  abstract cancelCharge(id: string): Promise<void>;
  abstract verifyWebhook(token: string | undefined): boolean;
}
