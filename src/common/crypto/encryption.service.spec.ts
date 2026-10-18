import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { EncryptionService } from './encryption.service';

function buildService(key = Buffer.alloc(32, 7)) {
  const config = { get: () => key.toString('base64') } as unknown as ConfigService<Env, true>;
  return new EncryptionService(config);
}

describe('EncryptionService', () => {
  it('decrypts what it encrypted', () => {
    const service = buildService();
    const encrypted = service.encrypt('JBSWY3DPEHPK3PXP');

    expect(encrypted).not.toContain('JBSWY3DPEHPK3PXP');
    expect(service.decrypt(encrypted)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('produces a different payload every time', () => {
    const service = buildService();
    expect(service.encrypt('same')).not.toBe(service.encrypt('same'));
  });

  it('fails with another key', () => {
    const encrypted = buildService().encrypt('secret');
    expect(() => buildService(Buffer.alloc(32, 9)).decrypt(encrypted)).toThrow();
  });
});
