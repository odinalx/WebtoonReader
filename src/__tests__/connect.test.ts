import { describe, expect, it } from 'vitest';
import { connectToken, isConnectPage } from '../connect';

const TOKEN = 'sori_abcdefghijklmnopqrstuvwxyz0123';

describe('connectToken', () => {
  it('accepts a well-formed request', () => {
    expect(connectToken({ source: 'dokhae-site', type: 'DOKHAE_CONNECT', token: TOKEN })).toBe(TOKEN);
  });
  it('ignores other sources and types', () => {
    expect(connectToken({ source: 'dokhae-extension', type: 'DOKHAE_CONNECT', token: TOKEN })).toBeNull();
    expect(connectToken({ source: 'dokhae-site', type: 'DOKHAE_PRESENT', token: TOKEN })).toBeNull();
    expect(connectToken('DOKHAE_CONNECT')).toBeNull();
    expect(connectToken(null)).toBeNull();
  });
  it('rejects tokens with the wrong shape', () => {
    const req = (token: unknown) => ({ source: 'dokhae-site', type: 'DOKHAE_CONNECT', token });
    expect(connectToken(req('sori_short'))).toBeNull();
    expect(connectToken(req(`abc_${TOKEN.slice(5)}`))).toBeNull();
    expect(connectToken(req(`${TOKEN} `))).toBeNull();
    expect(connectToken(req(`${TOKEN}<script>`))).toBeNull();
    expect(connectToken(req(42))).toBeNull();
  });
});

describe('isConnectPage', () => {
  const site = 'https://dokhae.fr';
  it('matches the connect page with or without a query', () => {
    expect(isConnectPage('https://dokhae.fr/connect-extension', site)).toBe(true);
    expect(isConnectPage('https://dokhae.fr/connect-extension?from=popup#x', site)).toBe(true);
  });
  it('refuses other pages and origins', () => {
    expect(isConnectPage('https://dokhae.fr/account', site)).toBe(false);
    expect(isConnectPage('https://evil.fr/connect-extension', site)).toBe(false);
    expect(isConnectPage('http://dokhae.fr/connect-extension', site)).toBe(false);
    expect(isConnectPage(undefined, site)).toBe(false);
  });
});
