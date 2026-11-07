import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createGuardedLookup, guardedRequest, SsrfError } from '../src/index.js';
import { fakeDns, startHttps, type TestServer } from './support/servers.js';
import { testCertificate } from './support/tls.js';

type LookupResult = { error: NodeJS.ErrnoException | null; address: unknown; family?: number };

function call(
  lookup: ReturnType<typeof createGuardedLookup>,
  hostname: string,
  options: { all?: boolean; family?: number } = {},
): Promise<LookupResult> {
  return new Promise((resolve) => {
    lookup(
      hostname,
      options,
      (error: NodeJS.ErrnoException | null, address: unknown, family?: number) =>
        resolve({ error, address, family }),
    );
  });
}

describe('guarded lookup (research R9.2, R9.4)', () => {
  it('returns the public addresses of the name', async () => {
    const lookup = createGuardedLookup({
      resolve: fakeDns({ 'good.test': ['8.8.8.8', '2606:4700:4700::1111'] }),
    });
    const result = await call(lookup, 'good.test', { all: true });
    expect(result.error).toBeNull();
    expect(result.address).toEqual([
      { address: '8.8.8.8', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ]);
  });

  it('returns one address and its family when the caller does not ask for all', async () => {
    const lookup = createGuardedLookup({ resolve: fakeDns({ 'good.test': ['8.8.8.8'] }) });
    const result = await call(lookup, 'good.test');
    expect(result.error).toBeNull();
    expect(result.address).toBe('8.8.8.8');
    expect(result.family).toBe(4);
  });

  it('rejects everything when any answer is non-public (fail closed, no picking the good one)', async () => {
    const lookup = createGuardedLookup({
      resolve: fakeDns({ 'mixed.test': ['8.8.8.8', '10.0.0.5'] }),
    });
    const result = await call(lookup, 'mixed.test', { all: true });
    expect(result.error).toBeInstanceOf(SsrfError);
    expect((result.error as SsrfError).code).toBe('SSRF_BLOCKED_ADDRESS');
    expect(result.address).toBeUndefined();
  });

  it.each([['127.0.0.1'], ['169.254.169.254'], ['::1'], ['::ffff:10.0.0.1'], ['fd00:ec2::254']])(
    'rejects a name that resolves to %s',
    async (address) => {
      const lookup = createGuardedLookup({ resolve: fakeDns({ 'inner.test': [address] }) });
      const result = await call(lookup, 'inner.test', { all: true });
      expect((result.error as SsrfError).code).toBe('SSRF_BLOCKED_ADDRESS');
    },
  );

  it('does not put the resolved address or the name in the error', async () => {
    const lookup = createGuardedLookup({ resolve: fakeDns({ 'inner.test': ['10.9.8.7'] }) });
    const result = await call(lookup, 'inner.test', { all: true });
    expect(result.error?.message).not.toContain('10.9.8.7');
    expect(result.error?.message).not.toContain('inner.test');
  });

  it('rejects a literal non-public address handed straight to the lookup', async () => {
    const lookup = createGuardedLookup({ resolve: fakeDns({}) });
    const result = await call(lookup, '2130706433', { all: true });
    expect((result.error as SsrfError).code).toBe('SSRF_BLOCKED_ADDRESS');
  });

  it('lets loopback through only with allowLoopback', async () => {
    const resolve = fakeDns({ 'local.test': ['127.0.0.1'] });
    const strict = await call(createGuardedLookup({ resolve }), 'local.test', { all: true });
    expect(strict.error).toBeInstanceOf(SsrfError);
    const loose = await call(createGuardedLookup({ resolve, allowLoopback: true }), 'local.test', {
      all: true,
    });
    expect(loose.error).toBeNull();
  });

  it('passes a failed resolution through as a network error, not as a block', async () => {
    const lookup = createGuardedLookup({ resolve: fakeDns({}) });
    const result = await call(lookup, 'nowhere.test', { all: true });
    expect(result.error).not.toBeInstanceOf(SsrfError);
    expect(result.error?.code).toBe('ENOTFOUND');
  });

  it('treats an empty answer as not found', async () => {
    const lookup = createGuardedLookup({ resolve: () => Promise.resolve([]) });
    const result = await call(lookup, 'empty.test', { all: true });
    expect(result.error?.code).toBe('ENOTFOUND');
  });
});

describe('DNS rebinding (research R9.4)', () => {
  let server: TestServer | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('connects to the first, validated answer and never resolves the name again', async () => {
    server = await startHttps((_req, res) => {
      res.setHeader('content-type', 'text/plain');
      res.end('first');
    });
    // First answer: reachable and allowed (loopback in tests). A second one would be internal.
    let resolutions = 0;
    const result = await guardedRequest({
      url: `https://api.test:${server.port}/`,
      method: 'GET',
      allowLoopback: true,
      tls: { ca: testCertificate().cert },
      resolve: () => {
        resolutions += 1;
        return Promise.resolve([
          { address: resolutions === 1 ? '127.0.0.1' : '169.254.169.254', family: 4 },
        ]);
      },
    });
    expect(result.body).toBe('first');
    expect(resolutions).toBe(1);
    expect(server.connections()).toBe(1);
  });

  it('refuses when the answer is internal and never opens the connection', async () => {
    const plain = createServer((_req, res) => res.end('x'));
    let accepted = 0;
    plain.on('connection', () => (accepted += 1));
    await new Promise<void>((resolve) => plain.listen(0, '127.0.0.1', resolve));
    const port = (plain.address() as { port: number }).port;
    try {
      await expect(
        guardedRequest({
          url: `https://rebind.test:${port}/`,
          method: 'GET',
          resolve: fakeDns({ 'rebind.test': ['192.168.0.9'] }),
        }),
      ).rejects.toMatchObject({ code: 'SSRF_BLOCKED_ADDRESS' });
      expect(accepted).toBe(0);
    } finally {
      plain.close();
    }
  });
});
