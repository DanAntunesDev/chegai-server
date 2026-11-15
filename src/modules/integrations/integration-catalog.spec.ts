import { maskSettings, mergeSettings } from './integration-catalog';

describe('integration settings', () => {
  it('keeps stored secrets when the form sends them blank', () => {
    expect(
      mergeSettings(
        'asaas',
        { apiKey: 'old-key', apiUrl: 'https://a' },
        { apiKey: '', apiUrl: 'https://b' },
      ),
    ).toEqual({ apiKey: 'old-key', apiUrl: 'https://b' });
  });

  it('clears plain fields when they are emptied', () => {
    expect(mergeSettings('n8n', { baseUrl: 'https://n8n' }, { baseUrl: '' })).toEqual({
      baseUrl: undefined,
    });
  });

  it('never returns secret values', () => {
    expect(maskSettings('asaas', { apiKey: 'abcd1234', apiUrl: 'https://a' })).toEqual({
      apiKey: { set: true, hint: '••••1234' },
      apiUrl: 'https://a',
    });
  });
});
