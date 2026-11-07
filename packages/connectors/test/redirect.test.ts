import type { IncomingHttpHeaders } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  guardedRequest,
  MAX_REDIRECTS,
  nextHop,
  type GuardedRequestOptions,
  type RequestState,
} from '../src/index.js';
import { fakeDns, startHttps, type TestServer } from './support/servers.js';
import { testCertificate } from './support/tls.js';

const servers: TestServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function serve(handler: Parameters<typeof startHttps>[0]): Promise<TestServer> {
  const server = await startHttps(handler);
  servers.push(server);
  return server;
}

function local(url: string, extra: Partial<GuardedRequestOptions> = {}): GuardedRequestOptions {
  return {
    url,
    method: 'GET',
    allowLoopback: true,
    resolve: fakeDns({
      'api.test': ['127.0.0.1'],
      'other.test': ['127.0.0.1'],
      'inner.test': ['10.1.2.3'],
    }),
    tls: { ca: testCertificate().cert },
    ...extra,
  };
}

const base = (extra: Partial<RequestState> = {}): RequestState => ({
  url: new URL('https://api.test/a/b'),
  method: 'POST',
  headers: { 'X-Custom': '1', 'Content-Type': 'application/json' },
  body: '{"a":1}',
  credentialHeader: { name: 'Authorization', value: 'Bearer secret' },
  idempotencyKey: 'run:node',
  ...extra,
});

describe('next hop of a redirect (research R9.5)', () => {
  it('allows at most three hops', () => {
    expect(MAX_REDIRECTS).toBe(3);
    expect(() => nextHop(base(), 302, '/x', 2)).not.toThrow();
    expect(() => nextHop(base(), 302, '/x', 3)).toThrowError(
      expect.objectContaining({ code: 'HTTP_TOO_MANY_REDIRECTS' }),
    );
  });

  it('follows only https', () => {
    expect(() => nextHop(base(), 302, 'http://api.test/x', 0)).toThrowError(
      expect.objectContaining({ code: 'HTTP_REDIRECT_NOT_ALLOWED' }),
    );
    expect(() => nextHop(base(), 302, 'ftp://api.test/x', 0)).toThrowError(
      expect.objectContaining({ code: 'HTTP_REDIRECT_NOT_ALLOWED' }),
    );
  });

  it('needs a valid Location', () => {
    expect(() => nextHop(base(), 302, undefined, 0)).toThrowError(
      expect.objectContaining({ code: 'HTTP_REDIRECT_NOT_ALLOWED' }),
    );
    expect(() => nextHop(base(), 302, 'https://', 0)).toThrowError(
      expect.objectContaining({ code: 'HTTP_REDIRECT_NOT_ALLOWED' }),
    );
    expect(() => nextHop(base(), 302, 'https://user:pw@api.test/', 0)).toThrowError(
      expect.objectContaining({ code: 'HTTP_REDIRECT_NOT_ALLOWED' }),
    );
  });

  it('resolves a relative Location against the current URL', () => {
    expect(nextHop(base(), 307, '../c?q=1', 0).url.href).toBe('https://api.test/c?q=1');
    expect(nextHop(base(), 307, '//other.test/z', 0).url.href).toBe('https://other.test/z');
  });

  it('keeps the credential and the idempotency key inside the same origin', () => {
    const hop = nextHop(base(), 307, '/other-path', 0);
    expect(hop.credentialHeader).toEqual({ name: 'Authorization', value: 'Bearer secret' });
    expect(hop.idempotencyKey).toBe('run:node');
  });

  it.each([
    ['another host', 'https://other.test/a/b'],
    ['another port', 'https://api.test:8443/a/b'],
    ['another subdomain', 'https://sub.api.test/a/b'],
  ])('drops the credential and the idempotency key towards %s', (_name, location) => {
    const hop = nextHop(base(), 307, location, 0);
    expect(hop.credentialHeader).toBeUndefined();
    expect(hop.idempotencyKey).toBeUndefined();
    expect(hop.headers['X-Custom']).toBe('1');
  });

  it.each([303, 301, 302])('turns a POST into a GET on %i and drops the body', (status) => {
    const hop = nextHop(base(), status, '/x', 0);
    expect(hop.method).toBe('GET');
    expect(hop.body).toBeUndefined();
    expect(Object.keys(hop.headers).map((name) => name.toLowerCase())).not.toContain(
      'content-type',
    );
  });

  it('turns any method into a GET on 303', () => {
    for (const method of ['PUT', 'PATCH', 'DELETE'] as const) {
      expect(nextHop(base({ method }), 303, '/x', 0).method).toBe('GET');
    }
  });

  it('keeps PUT, PATCH and DELETE on 301 and 302', () => {
    for (const method of ['PUT', 'PATCH', 'DELETE'] as const) {
      const hop = nextHop(base({ method }), 302, '/x', 0);
      expect(hop.method).toBe(method);
      expect(hop.body).toBe('{"a":1}');
    }
  });

  it.each([307, 308])('keeps method and body on %i', (status) => {
    const hop = nextHop(base(), status, '/x', 0);
    expect(hop.method).toBe('POST');
    expect(hop.body).toBe('{"a":1}');
    expect(hop.headers['Content-Type']).toBe('application/json');
  });
});

describe('redirects through the client', () => {
  it('follows a redirect inside the same origin and keeps the credential', async () => {
    let finalHeaders: IncomingHttpHeaders = {};
    const server = await serve((req, res) => {
      if (req.url === '/start') {
        res.writeHead(307, { location: '/end' });
        res.end();
        return;
      }
      finalHeaders = req.headers;
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('done');
    });
    const result = await guardedRequest(
      local(`https://api.test:${server.port}/start`, {
        method: 'POST',
        body: 'x',
        credentialHeader: { name: 'Authorization', value: 'Bearer s' },
        idempotencyKey: 'k',
      }),
    );
    expect(result.body).toBe('done');
    expect(finalHeaders['authorization']).toBe('Bearer s');
    expect(finalHeaders['idempotency-key']).toBe('k');
  });

  it('does not leak the credential or the idempotency key to another origin', async () => {
    let leaked: IncomingHttpHeaders = {};
    const target = await serve((req, res) => {
      leaked = req.headers;
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('target');
    });
    const origin = await serve((_req, res) => {
      res.writeHead(307, { location: `https://other.test:${target.port}/landing` });
      res.end();
    });
    const result = await guardedRequest(
      local(`https://api.test:${origin.port}/go`, {
        method: 'POST',
        body: 'payload',
        credentialHeader: { name: 'X-Api-Key', value: 'topsecret' },
        idempotencyKey: 'k',
        headers: { 'X-Custom': 'kept' },
      }),
    );
    expect(result.body).toBe('target');
    expect(leaked['x-api-key']).toBeUndefined();
    expect(leaked['idempotency-key']).toBeUndefined();
    expect(leaked['x-custom']).toBe('kept');
  });

  it('turns a POST into a GET after a 302 and keeps the body after a 307', async () => {
    const seen: { method?: string; body: string }[] = [];
    const server = await serve((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        if (req.url === '/302') {
          res.writeHead(302, { location: '/final' });
          res.end();
        } else if (req.url === '/307') {
          res.writeHead(307, { location: '/final' });
          res.end();
        } else {
          seen.push({ method: req.method, body: Buffer.concat(chunks).toString() });
          res.writeHead(200, { 'content-type': 'text/plain' });
          res.end('ok');
        }
      });
    });
    await guardedRequest(
      local(`https://api.test:${server.port}/302`, { method: 'POST', body: 'data' }),
    );
    await guardedRequest(
      local(`https://api.test:${server.port}/307`, { method: 'POST', body: 'data' }),
    );
    expect(seen).toEqual([
      { method: 'GET', body: '' },
      { method: 'POST', body: 'data' },
    ]);
  });

  it('stops after three hops', async () => {
    let calls = 0;
    const server = await serve((_req, res) => {
      calls += 1;
      res.writeHead(302, { location: '/again' });
      res.end();
    });
    await expect(
      guardedRequest(local(`https://api.test:${server.port}/loop`)),
    ).rejects.toMatchObject({ code: 'HTTP_TOO_MANY_REDIRECTS', errorClass: 'permanent' });
    expect(calls).toBe(4); // the first request plus three hops
  });

  it('follows exactly three hops', async () => {
    const server = await serve((req, res) => {
      const step = Number(req.url?.slice(1) ?? '0');
      if (step < 3) {
        res.writeHead(302, { location: `/${step + 1}` });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('arrived');
    });
    const result = await guardedRequest(local(`https://api.test:${server.port}/0`));
    expect(result.body).toBe('arrived');
  });

  it('refuses a hop to http', async () => {
    const server = await serve((_req, res) => {
      res.writeHead(302, { location: 'http://api.test/insecure' });
      res.end();
    });
    await expect(guardedRequest(local(`https://api.test:${server.port}/`))).rejects.toMatchObject({
      code: 'HTTP_REDIRECT_NOT_ALLOWED',
    });
  });

  it('fails a redirect status without Location', async () => {
    const server = await serve((_req, res) => {
      res.writeHead(302);
      res.end();
    });
    await expect(guardedRequest(local(`https://api.test:${server.port}/`))).rejects.toMatchObject({
      code: 'HTTP_REDIRECT_NOT_ALLOWED',
    });
  });

  it('revalidates the address of every hop: metadata is blocked', async () => {
    const server = await serve((_req, res) => {
      res.writeHead(302, { location: 'https://169.254.169.254/latest/meta-data/' });
      res.end();
    });
    await expect(guardedRequest(local(`https://api.test:${server.port}/`))).rejects.toMatchObject({
      code: 'SSRF_BLOCKED_ADDRESS',
    });
  });

  it('revalidates the address of every hop: a name that resolves inward is blocked', async () => {
    const server = await serve((_req, res) => {
      res.writeHead(302, { location: 'https://inner.test/admin' });
      res.end();
    });
    await expect(guardedRequest(local(`https://api.test:${server.port}/`))).rejects.toMatchObject({
      code: 'SSRF_BLOCKED_ADDRESS',
    });
  });

  it('revalidates the allowlist at every hop', async () => {
    const target = await serve((_req, res) => res.end('x'));
    const origin = await serve((_req, res) => {
      res.writeHead(302, { location: `https://other.test:${target.port}/` });
      res.end();
    });
    await expect(
      guardedRequest(local(`https://api.test:${origin.port}/`, { allowlist: ['api.test'] })),
    ).rejects.toMatchObject({ code: 'HTTP_HOST_NOT_ALLOWED' });
    expect(target.connections()).toBe(0);
  });

  it('follows a hop to a host that the allowlist covers', async () => {
    const target = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('allowed');
    });
    const origin = await serve((_req, res) => {
      res.writeHead(302, { location: `https://other.test:${target.port}/` });
      res.end();
    });
    const result = await guardedRequest(
      local(`https://api.test:${origin.port}/`, { allowlist: ['api.test', 'other.test'] }),
    );
    expect(result.body).toBe('allowed');
  });

  it('does not read the body of a redirect response', async () => {
    const server = await serve((req, res) => {
      if (req.url === '/') {
        res.writeHead(302, { location: '/end', 'content-type': 'image/png' });
        res.end(Buffer.alloc(3 * 1024 * 1024));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('end');
    });
    const result = await guardedRequest(local(`https://api.test:${server.port}/`));
    expect(result.body).toBe('end');
  });
});
