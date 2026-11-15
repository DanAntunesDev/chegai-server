import { assertPublicUrl, isPrivateAddress } from './safe-url';

describe('safe webhook urls', () => {
  it('spots private and loopback addresses', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.1',
      '192.168.0.10',
      '169.254.169.254',
      '::1',
      '::ffff:10.0.0.1',
      'fd00::1',
    ]) {
      expect(isPrivateAddress(address)).toBe(true);
    }
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
  });

  it('rejects plain http, credentials and internal hosts in production', async () => {
    await expect(assertPublicUrl('http://example.com/hook', false)).rejects.toThrow('https');
    await expect(assertPublicUrl('https://user:pass@example.com', false)).rejects.toThrow(
      'credentials',
    );
    await expect(assertPublicUrl('https://127.0.0.1/hook', false)).rejects.toThrow('internal');
    await expect(assertPublicUrl('https://169.254.169.254/latest', false)).rejects.toThrow(
      'internal',
    );
  });

  it('allows http to local tools while developing', async () => {
    await expect(assertPublicUrl('http://localhost:5678/webhook/x', true)).resolves.toBeInstanceOf(
      URL,
    );
  });
});
