import { describe, expect, it } from 'vitest';
import { isPublicAddress, normalizeIpLiteral } from '../src/index.js';

const PUBLIC_V4 = [
  '8.8.8.8',
  '1.1.1.1',
  '93.184.216.34',
  '11.0.0.1',
  '100.63.255.255',
  '100.128.0.1',
  '126.255.255.255',
  '128.0.0.1',
  '169.253.1.1',
  '172.15.255.255',
  '172.32.0.1',
  '192.0.1.1',
  '198.17.255.255',
  '198.20.0.1',
  '203.0.114.1',
  '223.255.255.255',
];

const NON_PUBLIC_V4: [string, string][] = [
  ['0.0.0.0', 'this network'],
  ['0.1.2.3', 'this network'],
  ['10.0.0.1', 'private 10/8'],
  ['10.255.255.255', 'private 10/8'],
  ['100.64.0.1', 'CGNAT'],
  ['100.127.255.255', 'CGNAT'],
  ['127.0.0.1', 'loopback'],
  ['127.255.255.254', 'loopback'],
  ['169.254.0.1', 'link-local'],
  ['169.254.169.254', 'cloud metadata'],
  ['172.16.0.1', 'private 172.16/12'],
  ['172.31.255.255', 'private 172.16/12'],
  ['192.0.0.1', 'IETF protocol'],
  ['192.0.2.1', 'TEST-NET-1'],
  ['192.88.99.1', '6to4 relay'],
  ['192.168.1.1', 'private 192.168/16'],
  ['198.18.0.1', 'benchmark'],
  ['198.19.255.255', 'benchmark'],
  ['198.51.100.7', 'TEST-NET-2'],
  ['203.0.113.9', 'TEST-NET-3'],
  ['224.0.0.1', 'multicast'],
  ['239.255.255.255', 'multicast'],
  ['240.0.0.1', 'reserved'],
  ['255.255.255.255', 'broadcast'],
];

const PUBLIC_V6 = [
  '2606:4700:4700::1111',
  '2001:4860:4860::8888',
  '2a00:1450:4001:81b::200e',
  '::ffff:8.8.8.8',
  '::ffff:808:808',
  '64:ff9b::808:808',
  '2002:808:808::1',
];

const NON_PUBLIC_V6: [string, string][] = [
  ['::', 'unspecified'],
  ['::1', 'loopback'],
  ['::ffff:127.0.0.1', 'mapped loopback'],
  ['::ffff:7f00:1', 'mapped loopback, hex form'],
  ['::ffff:10.0.0.1', 'mapped private'],
  ['::ffff:a9fe:a9fe', 'mapped metadata'],
  ['::FFFF:169.254.169.254', 'mapped metadata, upper case'],
  ['64:ff9b::7f00:1', 'NAT64 loopback'],
  ['64:ff9b::a00:1', 'NAT64 private'],
  ['64:ff9b:1::1', 'local-use NAT64'],
  ['100::1', 'discard'],
  ['2001::1', 'IETF protocol'],
  ['2001:0:4136:e378:8000:63bf:3fff:fdd2', 'Teredo'],
  ['2001:db8::1', 'documentation'],
  ['3fff::1', 'documentation'],
  ['2002:7f00:1::1', '6to4 of loopback'],
  ['2002:a9fe:a9fe::1', '6to4 of metadata'],
  ['fc00::1', 'ULA'],
  ['fd00:ec2::254', 'AWS IPv6 metadata (ULA)'],
  ['fe80::1', 'link-local'],
  ['fec0::1', 'site-local'],
  ['ff02::1', 'multicast'],
  ['fe80::1%eth0', 'zone identifier'],
  ['4000::1', 'outside global unicast'],
  ['0:0:0:0:0:0:0:1', 'loopback, long form'],
];

describe('public IPv4 addresses (research R9.3)', () => {
  it.each(PUBLIC_V4)('%s is public', (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });

  it.each(NON_PUBLIC_V4)('%s is not public (%s)', (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });
});

describe('public IPv6 addresses (research R9.3)', () => {
  it.each(PUBLIC_V6)('%s is public', (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });

  it.each(NON_PUBLIC_V6)('%s is not public (%s)', (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });
});

describe('alternative IPv4 forms are normalized before deciding', () => {
  it.each([
    ['2130706433', '127.0.0.1'],
    ['0x7f.1', '127.0.0.1'],
    ['0x7f000001', '127.0.0.1'],
    ['017700000001', '127.0.0.1'],
    ['0177.0.0.1', '127.0.0.1'],
    ['127.1', '127.0.0.1'],
    ['2852039166', '169.254.169.254'],
    ['0xa9fea9fe', '169.254.169.254'],
    ['134744072', '8.8.8.8'],
    ['[::1]', '::1'],
  ])('%s becomes %s', (form, canonical) => {
    expect(normalizeIpLiteral(form)).toBe(canonical);
  });

  it.each(['2130706433', '0x7f.1', '017700000001', '0177.0.0.1', '127.1', '[::1]', '2852039166'])(
    '%s is not public',
    (form) => {
      expect(isPublicAddress(form)).toBe(false);
    },
  );

  it('keeps a public address in decimal form public', () => {
    expect(isPublicAddress('134744072')).toBe(true);
  });

  it('does not take a host name for an address', () => {
    expect(normalizeIpLiteral('example.com')).toBeUndefined();
    expect(isPublicAddress('example.com')).toBe(false);
    expect(isPublicAddress('')).toBe(false);
    expect(isPublicAddress('999.1.1.1')).toBe(false);
  });
});

describe('loopback for tests only', () => {
  it('lets loopback through only when asked, and nothing else non-public', () => {
    expect(isPublicAddress('127.0.0.1', { allowLoopback: true })).toBe(true);
    expect(isPublicAddress('::1', { allowLoopback: true })).toBe(true);
    expect(isPublicAddress('10.0.0.1', { allowLoopback: true })).toBe(false);
    expect(isPublicAddress('169.254.169.254', { allowLoopback: true })).toBe(false);
    expect(isPublicAddress('127.0.0.1')).toBe(false);
  });
});
