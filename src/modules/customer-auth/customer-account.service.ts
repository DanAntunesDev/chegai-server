import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { AppError } from '../../common/errors/app-error';
import { isUniqueViolation } from '../../common/errors/prisma-errors';
import { normalizeBrazilianPhone } from '../../common/validation/fields';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  ConfirmAccountInput,
  LoginAccountInput,
  RegisterAccountInput,
} from './customer-account.schemas';
import { CUSTOMER_SESSION_TTL_SECONDS, CustomerTokenService } from './customer-token.service';
import { PhoneVerificationService } from './phone-verification.service';

@Injectable()
export class CustomerAccountService {
  private readonly dummyHash = hash('timing-equalizer-password');

  constructor(
    private readonly prisma: PrismaService,
    private readonly verification: PhoneVerificationService,
    private readonly tokens: CustomerTokenService,
  ) {}

  async register(tenant: { id: string; displayName: string }, input: RegisterAccountInput) {
    const passwordHash = await hash(input.password);
    await this.prisma.withTenant(tenant.id, async (tx) => {
      const byPhone = await tx.customer.findFirst({
        where: { phone: input.phone, deletedAt: null },
      });
      if (byPhone?.passwordHash && byPhone.phoneVerifiedAt) {
        throw AppError.conflict('ACCOUNT_EXISTS', 'There is already an account for this phone');
      }
      const byEmail = await tx.customer.findFirst({
        where: { email: input.email, deletedAt: null, NOT: { phone: input.phone } },
        select: { id: true },
      });
      if (byEmail) {
        throw AppError.conflict('EMAIL_TAKEN', 'This email is already in use');
      }
      try {
        if (byPhone) {
          await tx.customer.update({
            where: { id: byPhone.id },
            data: { name: input.name, email: input.email, passwordHash, phoneVerifiedAt: null },
          });
        } else {
          await tx.customer.create({
            data: {
              tenantId: tenant.id,
              name: input.name,
              phone: input.phone,
              email: input.email,
              passwordHash,
            },
          });
        }
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw AppError.conflict('EMAIL_TAKEN', 'This email is already in use');
        }
        throw error;
      }
    });
    return this.verification.request(tenant, input.phone);
  }

  async confirm(tenantId: string, input: ConfirmAccountInput) {
    await this.verification.verify(tenantId, input.phone, input.code);
    const customer = await this.prisma.withTenant(tenantId, async (tx) => {
      const found = await tx.customer.findFirst({
        where: { phone: input.phone, deletedAt: null, passwordHash: { not: null } },
      });
      if (!found) {
        throw AppError.notFound('ACCOUNT_NOT_FOUND', 'Create your account first');
      }
      return tx.customer.update({
        where: { id: found.id },
        data: { phoneVerifiedAt: new Date() },
      });
    });
    return this.session(tenantId, customer);
  }

  async login(tenantId: string, input: LoginAccountInput) {
    const login = input.login.toLowerCase();
    const phone = login.includes('@') ? null : normalizeBrazilianPhone(login);
    const customer = await this.prisma.withTenant(tenantId, (tx) =>
      tx.customer.findFirst({
        where: {
          deletedAt: null,
          passwordHash: { not: null },
          phoneVerifiedAt: { not: null },
          ...(phone ? { phone } : { email: login }),
        },
      }),
    );
    const valid = await verify(
      customer?.passwordHash ?? (await this.dummyHash),
      input.password,
    ).catch(() => false);
    if (!customer || !valid) {
      throw AppError.unauthorized('INVALID_CREDENTIALS', 'Wrong login or password');
    }
    return this.session(tenantId, customer);
  }

  async me(tenantId: string, phone: string) {
    const customer = await this.prisma.withTenant(tenantId, (tx) =>
      tx.customer.findFirst({ where: { phone, deletedAt: null } }),
    );
    if (!customer) {
      throw AppError.notFound('ACCOUNT_NOT_FOUND', 'Account not found');
    }
    return this.present(customer);
  }

  private async session(
    tenantId: string,
    customer: { name: string; email: string | null; phone: string; passwordHash: string | null },
  ) {
    return {
      token: await this.tokens.sign(
        { tenantId, phone: customer.phone },
        CUSTOMER_SESSION_TTL_SECONDS,
      ),
      expiresInSeconds: CUSTOMER_SESSION_TTL_SECONDS,
      customer: this.present(customer),
    };
  }

  private present(customer: {
    name: string;
    email: string | null;
    phone: string;
    passwordHash: string | null;
  }) {
    return {
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      hasAccount: Boolean(customer.passwordHash),
    };
  }
}
