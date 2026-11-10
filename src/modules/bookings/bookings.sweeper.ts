import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import type { Env } from '../../config/env';
import { BookingsService } from './bookings.service';

const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class BookingsSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BookingsSweeper.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly bookings: BookingsService,
    private readonly idempotency: IdempotencyService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit() {
    const seconds = this.config.get('BOOKING_SWEEP_INTERVAL_SECONDS', { infer: true });
    if (seconds > 0) {
      this.timer = setInterval(() => void this.tick(), seconds * 1000);
      this.timer.unref();
    }
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async tick(now = new Date()) {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const result = await this.bookings.sweep(now);
      await this.idempotency.purgeOlderThan(new Date(now.getTime() - IDEMPOTENCY_RETENTION_MS));
      if (result.expiredHolds || result.noShows) {
        this.logger.log(result, 'booking sweep');
      }
    } catch (error) {
      this.logger.error(error, 'booking sweep failed');
    } finally {
      this.running = false;
    }
  }
}
