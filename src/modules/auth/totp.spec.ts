import {
  buildOtpAuthUrl,
  decodeBase32,
  encodeBase32,
  generateTotp,
  generateTotpSecret,
  verifyTotp,
} from './totp';

const RFC_SECRET = encodeBase32(Buffer.from('12345678901234567890'));

describe('totp', () => {
  it('matches the RFC 6238 test vectors', () => {
    expect(generateTotp(RFC_SECRET, 59_000)).toBe('287082');
    expect(generateTotp(RFC_SECRET, 1_111_111_109_000)).toBe('081804');
    expect(generateTotp(RFC_SECRET, 1_234_567_890_000)).toBe('005924');
  });

  it('round trips base32', () => {
    const buffer = Buffer.from('chegai');
    expect(decodeBase32(encodeBase32(buffer))).toEqual(buffer);
  });

  it('accepts the previous and next code but not older ones', () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;

    expect(verifyTotp(secret, generateTotp(secret, now - 30_000), now)).toBe(true);
    expect(verifyTotp(secret, generateTotp(secret, now + 30_000), now)).toBe(true);
    expect(verifyTotp(secret, generateTotp(secret, now - 90_000), now)).toBe(false);
  });

  it('rejects malformed codes', () => {
    expect(verifyTotp(generateTotpSecret(), '12ab56')).toBe(false);
  });

  it('builds an otpauth url for authenticator apps', () => {
    const url = buildOtpAuthUrl('ABC', 'admin@chegai.local');
    expect(url.startsWith('otpauth://totp/Chega%C3%AD%3Aadmin%40chegai.local?')).toBe(true);
    expect(url).toContain('secret=ABC');
  });
});
