import { HIDDEN, parseBody, pickHeaders, redact } from './redact';

describe('log redaction', () => {
  it('hides secrets at any depth and keeps the rest', () => {
    expect(
      redact({
        email: 'dono@barbearia.com',
        password: 'segredo',
        customer: { name: 'João', code: '123456' },
        integrations: [{ accessToken: 'EAAG', phoneNumberId: '99' }],
        apiKey: '',
      }),
    ).toEqual({
      email: 'dono@barbearia.com',
      password: HIDDEN,
      customer: { name: 'João', code: HIDDEN },
      integrations: [{ accessToken: HIDDEN, phoneNumberId: '99' }],
      apiKey: '',
    });
  });

  it('never keeps authorization or cookies from headers', () => {
    expect(
      pickHeaders({ authorization: 'Bearer x', cookie: 'a=b', 'content-type': 'application/json' }),
    ).toEqual({ 'content-type': 'application/json' });
  });

  it('parses json responses and tolerates plain text', () => {
    expect(parseBody('{"ok":true}')).toEqual({ ok: true });
    expect(parseBody('ok')).toBe('ok');
    expect(parseBody('')).toBeNull();
  });
});
