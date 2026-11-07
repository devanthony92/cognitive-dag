import type { IncomingHttpHeaders } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { guardedRequest, MAX_RESPONSE_BYTES, type GuardedRequestOptions } from '../src/index.js';
import { fakeDns, startHttps, startSilentTcp, type TestServer } from './support/servers.js';
import { testCertificate } from './support/tls.js';

let server: TestServer | undefined;
let silent: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  await silent?.close();
  server = undefined;
  silent = undefined;
});

/** Options pointing a fake name at the local TLS server (research R9.10: tests only). */
function local(port: number, extra: Partial<GuardedRequestOptions> = {}): GuardedRequestOptions {
  return {
    url: `https://api.test:${port}/`,
    method: 'GET',
    allowLoopback: true,
    resolve: fakeDns({ 'api.test': ['127.0.0.1'], 'other.test': ['127.0.0.1'] }),
    tls: { ca: testCertificate().cert },
    ...extra,
  };
}

describe('guarded HTTP client (research R9, R11)', () => {
  it('returns status, content type and the body as text', async () => {
    server = await startHttps((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
    const result = await guardedRequest(local(server.port));
    expect(result).toMatchObject({ status: 200, body: '{"ok":true}' });
    expect(result.headers['content-type']).toBe('application/json');
  });

  it('returns 4xx and 5xx as responses: classifying them is the caller’s job', async () => {
    server = await startHttps((_req, res) => {
      res.writeHead(503, { 'content-type': 'text/plain', 'retry-after': '7' });
      res.end('busy');
    });
    const result = await guardedRequest(local(server.port));
    expect(result).toMatchObject({ status: 503, body: 'busy' });
    expect(result.headers['retry-after']).toBe('7');
  });

  it('accepts only https', async () => {
    await expect(
      guardedRequest({ url: 'http://api.test/', method: 'GET', resolve: fakeDns({}) }),
    ).rejects.toMatchObject({ code: 'HTTP_URL_INVALID', errorClass: 'permanent' });
    await expect(
      guardedRequest({ url: 'ftp://api.test/', method: 'GET', resolve: fakeDns({}) }),
    ).rejects.toMatchObject({ code: 'HTTP_URL_INVALID' });
    await expect(
      guardedRequest({ url: 'https://user:pass@api.test/', method: 'GET', resolve: fakeDns({}) }),
    ).rejects.toMatchObject({ code: 'HTTP_URL_INVALID' });
    await expect(
      guardedRequest({ url: 'not a url', method: 'GET', resolve: fakeDns({}) }),
    ).rejects.toMatchObject({ code: 'HTTP_URL_INVALID' });
  });

  it('refuses a literal internal address before any connection', async () => {
    await expect(
      guardedRequest({ url: 'https://127.0.0.1/', method: 'GET', resolve: fakeDns({}) }),
    ).rejects.toMatchObject({ code: 'SSRF_BLOCKED_ADDRESS' });
    await expect(
      guardedRequest({ url: 'https://2130706433/', method: 'GET', resolve: fakeDns({}) }),
    ).rejects.toMatchObject({ code: 'SSRF_BLOCKED_ADDRESS' });
    await expect(
      guardedRequest({ url: 'https://[::1]/', method: 'GET', resolve: fakeDns({}) }),
    ).rejects.toMatchObject({ code: 'SSRF_BLOCKED_ADDRESS' });
  });

  it('ignores the proxy variables of the environment', async () => {
    server = await startHttps((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('direct');
    });
    const saved = { ...process.env };
    process.env['HTTPS_PROXY'] = 'http://127.0.0.1:9';
    process.env['HTTP_PROXY'] = 'http://127.0.0.1:9';
    process.env['NODE_USE_ENV_PROXY'] = '1';
    try {
      const result = await guardedRequest(local(server.port));
      expect(result.body).toBe('direct');
      expect(server.connections()).toBe(1);
    } finally {
      for (const key of ['HTTPS_PROXY', 'HTTP_PROXY', 'NODE_USE_ENV_PROXY']) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    }
  });

  it('verifies the certificate against the original name, not the IP', async () => {
    server = await startHttps((_req, res) => res.end('x'));
    // The certificate does not cover wrong.test.
    await expect(
      guardedRequest({
        ...local(server.port),
        url: `https://wrong.test:${server.port}/`,
        resolve: fakeDns({ 'wrong.test': ['127.0.0.1'] }),
      }),
    ).rejects.toMatchObject({ code: 'HTTP_TLS_ERROR', errorClass: 'permanent' });
  });

  it('sends method, body, headers, user agent and the managed headers', async () => {
    let seen: { method?: string; headers: IncomingHttpHeaders; body: string } | undefined;
    server = await startHttps((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        seen = { method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString() };
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok');
      });
    });
    await guardedRequest(
      local(server.port, {
        method: 'POST',
        url: `https://api.test:${server.port}/items?x=1`,
        body: '{"a":"ñ"}',
        headers: { 'X-Custom': 'yes', 'Content-Type': 'application/json' },
        credentialHeader: { name: 'Authorization', value: 'Bearer s3cret' },
        idempotencyKey: 'run:node',
      }),
    );
    expect(seen?.method).toBe('POST');
    expect(seen?.body).toBe('{"a":"ñ"}');
    expect(seen?.headers['x-custom']).toBe('yes');
    expect(seen?.headers['content-type']).toBe('application/json');
    expect(seen?.headers['authorization']).toBe('Bearer s3cret');
    expect(seen?.headers['idempotency-key']).toBe('run:node');
    expect(seen?.headers['user-agent']).toBe('CognitiveDAG/1');
    expect(seen?.headers['content-length']).toBe(String(Buffer.byteLength('{"a":"ñ"}')));
    expect(seen?.headers['host']).toBe(`api.test:${server.port}`);
  });

  it('refuses headers the system manages', async () => {
    server = await startHttps((_req, res) => res.end('x'));
    for (const name of [
      'Host',
      'Content-Length',
      'Idempotency-Key',
      'Transfer-Encoding',
      'Proxy-Authorization',
    ]) {
      await expect(
        guardedRequest(local(server.port, { headers: { [name]: 'x' } })),
      ).rejects.toMatchObject({ code: 'HTTP_HEADER_FORBIDDEN' });
    }
  });
});

describe('response limits (research R11)', () => {
  it('cuts a stream without Content-Length once it passes 1 MiB', async () => {
    let written = 0;
    server = await startHttps((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' }); // chunked: no Content-Length
      const chunk = Buffer.alloc(64 * 1024, 'a');
      const pump = (): void => {
        while (written < 8 * 1024 * 1024) {
          written += chunk.length;
          if (!res.write(chunk)) {
            res.once('drain', pump);
            return;
          }
        }
        res.end();
      };
      pump();
    });
    await expect(guardedRequest(local(server.port))).rejects.toMatchObject({
      code: 'HTTP_RESPONSE_TOO_LARGE',
      errorClass: 'permanent',
    });
    // It read the stream and stopped: the server could not push all of the 8 MiB.
    expect(written).toBeLessThan(8 * 1024 * 1024);
  });

  it('refuses a declared Content-Length above the limit', async () => {
    server = await startHttps((_req, res) => {
      res.writeHead(200, {
        'content-type': 'text/plain',
        'content-length': String(MAX_RESPONSE_BYTES + 1),
      });
      res.write('a'.repeat(1000));
    });
    await expect(guardedRequest(local(server.port))).rejects.toMatchObject({
      code: 'HTTP_RESPONSE_TOO_LARGE',
    });
  });

  it('does not trust a Content-Length that undersells the body', async () => {
    // Raw TLS server: it announces 10 bytes and keeps sending 2 MiB.
    const { createServer } = await import('node:tls');
    const { key, cert } = testCertificate();
    const raw = createServer({ key, cert }, (socket) => {
      socket.on('error', () => undefined);
      socket.once('data', () => {
        socket.write(
          'HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 10\r\n\r\n' +
            'a'.repeat(2 * 1024 * 1024),
        );
      });
    });
    await new Promise<void>((resolve) => raw.listen(0, '127.0.0.1', resolve));
    const port = (raw.address() as { port: number }).port;
    try {
      // Either the client stops at the announced length, or it rejects the broken framing; what it
      // must never do is hand back more than the limit.
      const outcome = await guardedRequest(local(port)).then(
        (result) => result.body.length,
        (error: unknown) => (error as { code?: string }).code,
      );
      if (typeof outcome === 'number') expect(outcome).toBeLessThanOrEqual(MAX_RESPONSE_BYTES);
      else expect(['HTTP_NETWORK_ERROR', 'HTTP_RESPONSE_TOO_LARGE']).toContain(outcome);
    } finally {
      raw.close();
    }
  });

  it('accepts a body of exactly 1 MiB', async () => {
    server = await startHttps((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(Buffer.alloc(MAX_RESPONSE_BYTES, 'b'));
    });
    const result = await guardedRequest(local(server.port));
    expect(result.body.length).toBe(MAX_RESPONSE_BYTES);
  });

  it.each([
    ['application/json'],
    ['application/json; charset=utf-8'],
    ['application/problem+json'],
    ['application/vnd.api+json'],
    ['text/plain'],
    ['text/html; charset=utf-8'],
    ['text/csv'],
  ])('accepts %s', async (contentType) => {
    server = await startHttps((_req, res) => {
      res.writeHead(200, { 'content-type': contentType });
      res.end('hello');
    });
    const result = await guardedRequest(local(server.port));
    expect(result.body).toBe('hello');
  });

  it.each([
    ['image/png'],
    ['application/xml'],
    ['application/octet-stream'],
    ['multipart/form-data'],
  ])('refuses %s', async (contentType) => {
    server = await startHttps((_req, res) => {
      res.writeHead(200, { 'content-type': contentType });
      res.end('data');
    });
    await expect(guardedRequest(local(server.port))).rejects.toMatchObject({
      code: 'HTTP_CONTENT_TYPE_UNSUPPORTED',
      errorClass: 'permanent',
    });
  });

  it('refuses a body without content type, but accepts an empty one', async () => {
    server = await startHttps((req, res) => {
      if (req.url === '/empty') {
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(200);
      res.end('data');
    });
    await expect(guardedRequest(local(server.port))).rejects.toMatchObject({
      code: 'HTTP_CONTENT_TYPE_UNSUPPORTED',
    });
    const empty = await guardedRequest(
      local(server.port, { url: `https://api.test:${server.port}/empty` }),
    );
    expect(empty).toMatchObject({ status: 204, body: '' });
  });

  it('decodes UTF-8 even when a character is split between chunks', async () => {
    server = await startHttps((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      const bytes = Buffer.from('señor €5 ✓', 'utf8');
      res.write(bytes.subarray(0, 3)); // cuts the two bytes of « ñ » in half
      setTimeout(() => res.end(bytes.subarray(3)), 20);
    });
    const result = await guardedRequest(local(server.port));
    expect(result.body).toBe('señor €5 ✓');
  });
});

describe('timeouts (research R11)', () => {
  it('stops waiting for a slow response after the total timeout', async () => {
    server = await startHttps((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('late');
      }, 2000);
    });
    const started = Date.now();
    await expect(guardedRequest(local(server.port, { totalTimeoutMs: 200 }))).rejects.toMatchObject(
      { code: 'HTTP_TIMEOUT', errorClass: 'timeout' },
    );
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('applies the total timeout to a body that never ends', async () => {
    server = await startHttps((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('start');
    });
    await expect(guardedRequest(local(server.port, { totalTimeoutMs: 200 }))).rejects.toMatchObject(
      { code: 'HTTP_TIMEOUT' },
    );
  });

  it('gives up on a connection that never completes the handshake', async () => {
    silent = await startSilentTcp();
    const started = Date.now();
    await expect(
      guardedRequest(local(silent.port, { connectTimeoutMs: 150, totalTimeoutMs: 5000 })),
    ).rejects.toMatchObject({ code: 'HTTP_TIMEOUT', errorClass: 'timeout' });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('classifies a refused connection as a transient network error', async () => {
    server = await startHttps((_req, res) => res.end('x'));
    const port = server.port;
    await server.close();
    server = undefined;
    await expect(guardedRequest(local(port))).rejects.toMatchObject({
      code: 'HTTP_NETWORK_ERROR',
      errorClass: 'transient',
    });
  });

  it('classifies a name that does not exist as a transient network error', async () => {
    await expect(
      guardedRequest({ url: 'https://nowhere.test/', method: 'GET', resolve: fakeDns({}) }),
    ).rejects.toMatchObject({ code: 'HTTP_NETWORK_ERROR', errorClass: 'transient' });
  });
});
