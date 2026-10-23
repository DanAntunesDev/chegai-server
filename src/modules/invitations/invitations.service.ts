import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import type { TransactionClient } from '../../prisma/prisma.service';
import { hashToken } from '../auth/token.service';
import { MailService } from '../mail/mail.service';
import { invitationEmail } from '../mail/templates';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface CreatedInvitation {
  id: string;
  email: string;
  name: string | null;
  link: string;
  barbershop: string;
}

@Injectable()
export class InvitationsService {
  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly mail: MailService,
  ) {}

  async create(
    tx: TransactionClient,
    params: {
      tenantId: string;
      roleId: string;
      email: string;
      name?: string | null;
      invitedById: string | null;
    },
  ): Promise<CreatedInvitation> {
    const token = randomBytes(32).toString('base64url');
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: params.tenantId } });

    const invitation = await tx.invitation.create({
      data: {
        tenantId: params.tenantId,
        roleId: params.roleId,
        email: params.email.toLowerCase(),
        name: params.name ?? null,
        tokenHash: hashToken(token),
        invitedById: params.invitedById,
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      },
    });

    return {
      id: invitation.id,
      email: invitation.email,
      name: invitation.name,
      link: `${this.config.get('WEB_URL', { infer: true })}/convite/${token}`,
      barbershop: tenant.displayName,
    };
  }

  async send(invitation: CreatedInvitation): Promise<void> {
    const content = invitationEmail({
      barbershop: invitation.barbershop,
      name: invitation.name,
      link: invitation.link,
    });
    await this.mail.send({ to: invitation.email, ...content });
  }
}
