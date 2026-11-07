import type { RequestListener } from 'node:http';
import { createServer as createHttpsServer, type Server } from 'node:https';
import { createServer as createTcpServer, type Server as TcpServer } from 'node:net';
import type { AddressInfo, Socket } from 'node:net';
import net from 'node:net';
import { vi } from 'vitest';
import { testCertificate } from './tls.js';
import type { DnsAnswer, ResolveFn } from '../../src/index.js';

export interface TestServer {
  port: number;
  /** Connections accepted by the TCP listener. */
  connections: () => number;
  close: () => Promise<void>;
}

export async function startHttps(handler: RequestListener): Promise<TestServer> {
  const { key, cert } = testCertificate();
  const server: Server = createHttpsServer({ key, cert }, handler);
  let count = 0;
  server.on('connection', () => (count += 1));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    connections: () => count,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** A plain TCP listener that accepts and says nothing (hangs the TLS handshake). */
export async function startSilentTcp(): Promise<TestServer> {
  const sockets = new Set<Socket>();
  let count = 0;
  const server: TcpServer = createTcpServer((socket) => {
    count += 1;
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    connections: () => count,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

/** Fake DNS: names map to a fixed answer list; unknown names do not exist. */
export function fakeDns(
  table: Record<string, string[]>,
): ResolveFn & { calls: Map<string, number> } {
  const calls = new Map<string, number>();
  const resolve = ((hostname: string): Promise<DnsAnswer[]> => {
    calls.set(hostname, (calls.get(hostname) ?? 0) + 1);
    const addresses = table[hostname];
    if (!addresses) {
      return Promise.reject(
        Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' }),
      );
    }
    return Promise.resolve(
      addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
    );
  }) as ResolveFn & { calls: Map<string, number> };
  resolve.calls = calls;
  return resolve;
}

/**
 * Counts the TCP connections the process actually opens (the `connect` event of a socket). A lookup
 * that fails never gets there, so for a blocked destination the count has to stay at zero.
 */
export function trackConnections(): { count: () => number; restore: () => void } {
  let count = 0;
  // eslint-disable-next-line @typescript-eslint/unbound-method -- called back with the real `this`
  const original = net.Socket.prototype.emit;
  const spy = vi.spyOn(net.Socket.prototype, 'emit').mockImplementation(function (
    this: net.Socket,
    event: string | symbol,
    ...args: unknown[]
  ) {
    if (event === 'connect') count += 1;
    return Reflect.apply(original, this, [event, ...args]) as boolean;
  });
  return { count: () => count, restore: () => spy.mockRestore() };
}
