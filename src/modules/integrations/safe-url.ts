import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

function privateV4(address: string) {
  const [a = 0, b = 0] = address.split('.').map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

function privateV6(address: string) {
  const value = address.toLowerCase();
  if (value.startsWith('::ffff:')) {
    return privateV4(value.slice(7));
  }
  return (
    value === '::1' ||
    value === '::' ||
    value.startsWith('fc') ||
    value.startsWith('fd') ||
    value.startsWith('fe80')
  );
}

export function isPrivateAddress(address: string) {
  return isIP(address) === 6 ? privateV6(address) : privateV4(address);
}

export async function assertPublicUrl(raw: string, allowInsecure: boolean) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('invalid url');
  }
  if (url.protocol !== 'https:' && !(allowInsecure && url.protocol === 'http:')) {
    throw new Error('only https urls are allowed');
  }
  if (url.username || url.password) {
    throw new Error('credentials in url are not allowed');
  }
  if (allowInsecure) {
    return url;
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addresses.some((item) => isPrivateAddress(item.address))) {
    throw new Error('internal addresses are not allowed');
  }
  return url;
}
