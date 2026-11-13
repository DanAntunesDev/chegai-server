import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { localDateOf, toLocalParts } from '../availability/zoned-time';
import { BillingService } from './billing.service';

const RUN_AT_MINUTE = 6 * 60;
const CHECK_EVERY_MS = 5 * 60 * 1000;

@Injectable()
export class BillingScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BillingScheduler.name);
  private timer: NodeJS.Timeout | undefined;
  private lastRun: string | null = null;

  constructor(
    private readonly billing: BillingService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit() {
    if (this.config.get('BILLING_JOB_ENABLED', { infer: true })) {
      this.timer = setInterval(() => void this.tick(), CHECK_EVERY_MS);
      this.timer.unref();
    }
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async tick(now = new Date()) {
    const today = localDateOf(now, 'America/Sao_Paulo');
    if (this.lastRun === today || minuteOfDay(now) < RUN_AT_MINUTE) {
      return;
    }
    this.lastRun = today;
    try {
      const result = await this.billing.runDaily(today);
      this.logger.log(result, 'billing run');
    } catch (error) {
      this.lastRun = null;
      this.logger.error(error, 'billing run failed');
    }
  }
}

function minuteOfDay(now: Date) {
  const parts = toLocalParts(now, 'America/Sao_Paulo');
  return parts.hour * 60 + parts.minute;
}
