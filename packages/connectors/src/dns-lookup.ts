import { lookup as dnsLookup } from 'node:dns/promises';
import type { LookupFunction } from 'node:net';
import { isPublicAddress, normalizeIpLiteral, type AddressOptions } from './address.js';
import { SsrfError } from './errors.js';

export interface DnsAnswer {
  address: string;
  family: 4 | 6;
}

/** Resolves a name to all its addresses. Injected in tests as a fake DNS. */
export type ResolveFn = (hostname: string) => Promise<DnsAnswer[]>;

/** The system resolver, with every answer and in the order the DNS gave them (research R9.2). */
export const systemResolve: ResolveFn = async (hostname) => {
  const answers = await dnsLookup(hostname, { all: true, verbatim: true });
  return answers.map(({ address, family }) => ({ address, family: family === 6 ? 6 : 4 }));
};

export interface GuardedLookupOptions extends AddressOptions {
  resolve?: ResolveFn;
}

function notFound(): NodeJS.ErrnoException {
  return Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
}

/**
 * Resolves the name once, checks every answer and fails the whole lookup if any is not public
 * (research R9.2, R9.4). Used as the `lookup` of `node:https`: the address it returns is the one the
 * socket opens, so the name is never resolved a second time (no DNS rebinding window).
 */
export function createGuardedLookup(options: GuardedLookupOptions = {}): LookupFunction {
  const resolve = options.resolve ?? systemResolve;

  const answersFor = async (hostname: string): Promise<DnsAnswer[]> => {
    const literal = normalizeIpLiteral(hostname);
    if (literal !== undefined) {
      return [{ address: literal, family: literal.includes(':') ? 6 : 4 }];
    }
    return resolve(hostname);
  };

  return (hostname, lookupOptions, callback) => {
    answersFor(hostname)
      .then((answers) => {
        if (answers.length === 0) throw notFound();
        if (!answers.every((answer) => isPublicAddress(answer.address, options))) {
          throw new SsrfError();
        }
        const wanted =
          lookupOptions.family === 4 || lookupOptions.family === 6 ? lookupOptions.family : 0;
        const usable =
          wanted === 0 ? answers : answers.filter((answer) => answer.family === wanted);
        if (usable.length === 0) throw notFound();
        return usable;
      })
      .then(
        (usable) => {
          if (lookupOptions.all) {
            callback(null, usable);
            return;
          }
          const [first] = usable;
          callback(null, first?.address ?? '', first?.family);
        },
        // As the system lookup does on failure: an error and no address.
        (error: unknown) =>
          (callback as (error: NodeJS.ErrnoException) => void)(error as NodeJS.ErrnoException),
      );
  };
}
