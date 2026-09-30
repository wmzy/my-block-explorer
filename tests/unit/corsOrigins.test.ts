// isLoopbackRemoteAddress (middleware/cors-origins): the socket-address
// trust predicate behind two fail-closed gates — the Vite dev bridge's
// Origin synthesis (only loopback peers get a synthesized loopback Origin;
// Host alone is client-controlled) and the same policy the API's
// Origin-less URL-redaction path applies. Every address shape Node's
// socket parser can report must land on the right side: the loopback
// family (127.0.0.0/8, ::1, and the ::ffff:-mapped IPv4 form dual-stack
// listeners produce) is trusted; everything else — LAN peers, adjacent
// ranges, unspecified addresses, and unparsable input — fails closed.
import { describe, it, expect } from 'vitest';

import { isLoopbackRemoteAddress } from '@/middleware/cors-origins';

describe('isLoopbackRemoteAddress (loopback family)', () => {
  it.each([
    ['127.0.0.1', 'canonical v4 loopback'],
    ['127.0.0.0', 'network end of 127.0.0.0/8'],
    ['127.255.255.255', 'broadcast end of 127.0.0.0/8'],
    ['127.42.0.9', 'any host inside 127.0.0.0/8, not just .1'],
    ['::1', 'IPv6 loopback'],
    ['::ffff:127.0.0.1', 'v4-mapped loopback (dual-stack listener form)'],
    ['::ffff:127.3.4.5', 'v4-mapped 127.0.0.0/8, not just .1'],
    ['::FFFF:127.0.0.1', 'v4-mapped loopback, uppercase prefix'],
  ])('trusts %s (%s)', address => {
    expect(isLoopbackRemoteAddress(address)).toBe(true);
  });
});

describe('isLoopbackRemoteAddress (non-loopback, fails closed)', () => {
  it.each([
    ['192.168.1.5', 'LAN peer — the forged-Host attacker this gate exists for'],
    ['10.0.0.1', 'private range, still a remote peer'],
    ['172.16.0.1', 'private range, still a remote peer'],
    ['8.8.8.8', 'public internet'],
    ['128.0.0.1', 'adjacent /8, outside 127.0.0.0/8'],
    ['::ffff:192.168.1.5', 'v4-mapped LAN peer'],
    ['::ffff:10.1.2.3', 'v4-mapped private-range peer'],
    ['::', 'IPv6 unspecified — must not inherit loopback trust'],
    ['0.0.0.0', 'IPv4 unspecified — must not inherit loopback trust'],
    ['fe80::1', 'IPv6 link-local (this link ≠ this host)'],
    ['2001:db8::1', 'global IPv6'],
  ])('does not trust %s (%s)', address => {
    expect(isLoopbackRemoteAddress(address)).toBe(false);
  });

  it('does not trust absent socket info or non-address strings', () => {
    // Socket info missing / unset — the fail-closed default.
    expect(isLoopbackRemoteAddress(undefined)).toBe(false);
    expect(isLoopbackRemoteAddress(null)).toBe(false);
    expect(isLoopbackRemoteAddress('')).toBe(false);
    // Hostnames and short forms are not socket addresses; Node's parser
    // never reports them, so they get no loopback trust.
    expect(isLoopbackRemoteAddress('localhost')).toBe(false);
    expect(isLoopbackRemoteAddress('127.1')).toBe(false);
  });
});
