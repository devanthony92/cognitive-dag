import { afterEach, describe, expect, it, vi } from 'vitest';
import { guardedRequest, type GuardedRequestOptions } from '../src/index.js';
import {
  fakeDns,
  startHttps,
  startSilentTcp,
  trackConnections,
  type TestServer,
} from './support/servers.js';
import { testCertificate } from './support/tls.js';

/**
 * SC-002: a battery of at least 25 destinations that must never reach a non-public address. The
 * check is the number of sockets the process opens: it has to be zero for all of them.
 */
const DNS = fakeDns({
  'to-loopback.test': ['127.0.0.1'],
  'to-private10.test': ['10.0.0.8'],
  'to-private172.test': ['172.20.1.1'],
  'to-private192.test': ['192.168.0.10'],
  'to-metadata.test': ['169.254.169.254'],
  'to-cgnat.test': ['100.64.1.1'],
  'to-ipv6-loopback.test': ['::1'],
  'to-ipv6-ula.test': ['fd00:ec2::254'],
  'to-mapped.test': ['::ffff:127.0.0.1'],
  'to-mixed.test': ['8.8.8.8', '10.0.0.1'],
  'to-nat64.test': ['64:ff9b::7f00:1'],
  'to-6to4.test': ['2002:a9fe:a9fe::1'],
  'to-teredo.test': ['2001:0:4136:e378:8000:63bf:3fff:fdd2'],
});

const DESTINATIONS: [string, string][] = [
  ['loopback literal', 'https://127.0.0.1/'],
  ['loopback in 127/8', 'https://127.1.2.3/'],
  ['unspecified', 'https://0.0.0.0/'],
  ['private 10/8', 'https://10.0.0.1/'],
  ['private 172.16/12', 'https://172.16.5.5/'],
  ['private 192.168/16', 'https://192.168.1.1/'],
  ['link-local', 'https://169.254.1.1/'],
  ['cloud metadata', 'https://169.254.169.254/latest/meta-data/'],
  ['CGNAT', 'https://100.64.0.1/'],
  ['benchmark', 'https://198.18.0.1/'],
  ['multicast', 'https://224.0.0.1/'],
  ['broadcast', 'https://255.255.255.255/'],
  ['IPv6 loopback', 'https://[::1]/'],
  ['IPv6 ULA metadata', 'https://[fd00:ec2::254]/'],
  ['IPv6 link-local', 'https://[fe80::1]/'],
  ['IPv4-mapped loopback', 'https://[::ffff:127.0.0.1]/'],
  ['IPv4-mapped metadata, hex', 'https://[::ffff:a9fe:a9fe]/'],
  ['NAT64 of loopback', 'https://[64:ff9b::7f00:1]/'],
  ['6to4 of metadata', 'https://[2002:a9fe:a9fe::1]/'],
  ['decimal form', 'https://2130706433/'],
  ['hexadecimal form', 'https://0x7f000001/'],
  ['octal form', 'https://0177.0.0.1/'],
  ['short form', 'https://127.1/'],
  ['name to loopback', 'https://to-loopback.test/'],
  ['name to 10/8', 'https://to-private10.test/'],
  ['name to 172.16/12', 'https://to-private172.test/'],
  ['name to 192.168/16', 'https://to-private192.test/'],
  ['name to metadata', 'https://to-metadata.test/'],
  ['name to CGNAT', 'https://to-cgnat.test/'],
  ['name to IPv6 loopback', 'https://to-ipv6-loopback.test/'],
  ['name to IPv6 ULA', 'https://to-ipv6-ula.test/'],
  ['name to mapped loopback', 'https://to-mapped.test/'],
  ['name to public and private (mixed)', 'https://to-mixed.test/'],
  ['name to NAT64', 'https://to-nat64.test/'],
  ['name to 6to4', 'https://to-6to4.test/'],
  ['name to Teredo', 'https://to-teredo.test/'],
];

function options(url: string, extra: Partial<GuardedRequestOptions> = {}): GuardedRequestOptions {
  return { url, method: 'GET', resolve: DNS, ...extra };
}

let servers: TestServer[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.map((server) => server.close()));
  servers = [];
});

describe('SSRF battery (SC-002)', () => {
  it('has at least 25 destinations', () => {
    expect(DESTINATIONS.length).toBeGreaterThanOrEqual(25);
  });

  it('opens no socket for any of them', async () => {
    const tracker = trackConnections();
    for (const [name, url] of DESTINATIONS) {
      await expect(guardedRequest(options(url)), name).rejects.toMatchObject({
        code: 'SSRF_BLOCKED_ADDRESS',
        errorClass: 'permanent',
      });
    }
    expect(tracker.count()).toBe(0);
    tracker.restore();
  });

  it('opens no socket when a redirect points at an internal destination', async () => {
    const targets = [
      'https://169.254.169.254/',
      'https://to-private10.test/',
      'https://[fd00:ec2::254]/',
    ];
    for (const target of targets) {
      const origin = await startHttps((_req, res) => {
        res.writeHead(302, { location: target });
        res.end();
      });
      servers.push(origin);
      const tracker = trackConnections();
      await expect(
        guardedRequest(
          options(`https://api.test:${origin.port}/`, {
            allowLoopback: true,
            tls: { ca: testCertificate().cert },
            resolve: fakeDns({ 'api.test': ['127.0.0.1'], 'to-private10.test': ['10.0.0.8'] }),
          }),
        ),
      ).rejects.toMatchObject({ code: 'SSRF_BLOCKED_ADDRESS' });
      // One connection only: to the public (here loopback-for-tests) origin, never to the target.
      expect(tracker.count()).toBe(1);
      expect(origin.connections()).toBe(1);
      tracker.restore();
    }
  });

  it('does connect to a listener on loopback only when tests allow loopback (control)', async () => {
    const silent = await startSilentTcp();
    servers.push(silent);
    await expect(
      guardedRequest(options(`https://127.0.0.1:${silent.port}/`)),
    ).rejects.toMatchObject({ code: 'SSRF_BLOCKED_ADDRESS' });
    expect(silent.connections()).toBe(0);

    await expect(
      guardedRequest(
        options(`https://127.0.0.1:${silent.port}/`, {
          allowLoopback: true,
          connectTimeoutMs: 100,
        }),
      ),
    ).rejects.toMatchObject({ code: 'HTTP_TIMEOUT' });
    expect(silent.connections()).toBe(1);
  });

  it('never lets the test escape hatch open the door to non-loopback internal ranges', async () => {
    const tracker = trackConnections();
    for (const url of [
      'https://169.254.169.254/',
      'https://10.0.0.1/',
      'https://to-private10.test/',
      'https://to-metadata.test/',
      'https://[fd00:ec2::254]/',
    ]) {
      await expect(guardedRequest(options(url, { allowLoopback: true }))).rejects.toMatchObject({
        code: 'SSRF_BLOCKED_ADDRESS',
      });
    }
    expect(tracker.count()).toBe(0);
    tracker.restore();
  });
});
