import { shouldLog } from './request-log.middleware';

describe('request log filter', () => {
  it('keeps every change and every failure but skips quiet reads', () => {
    expect(shouldLog('POST', '/v1/bookings/holds', 201)).toBe(true);
    expect(shouldLog('DELETE', '/v1/tags/1', 204)).toBe(true);
    expect(shouldLog('GET', '/v1/bookings', 200)).toBe(false);
    expect(shouldLog('GET', '/v1/bookings', 404)).toBe(true);
    expect(shouldLog('GET', '/health', 500)).toBe(false);
  });
});
