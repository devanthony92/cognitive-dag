/**
 * Classification of IP addresses for the anti-SSRF guard (research R9.1 and R9.3).
 *
 * The rule is a closed list: an address is public only when it is clearly global unicast. Anything
 * the lists below do not recognize as such is blocked.
 */

export interface AddressOptions {
  /** Tests only (`HTTP_TEST_ALLOW_LOOPBACK`): lets 127.0.0.0/8 and ::1 through, nothing else. */
  allowLoopback?: boolean;
}

const IPV4_CHARS = /^[0-9a-fA-FxX.]+$/;
const IPV6_CHARS = /^[0-9a-fA-F:.]+$/;
const DOTTED_QUAD = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * Canonical text of an IP literal, or undefined when the input is not one. IPv4 in decimal, octal,
 * hexadecimal or short form (`2130706433`, `0177.0.0.1`, `0x7f.1`, `127.1`) becomes dotted
 * quad exactly as the WHATWG URL parser (the one `node:https` callers use) reads it; IPv6 comes
 * out compressed and lower case, without brackets.
 */
export function normalizeIpLiteral(input: string): string | undefined {
  if (input.length === 0 || input.length > 64) return undefined;
  const bracketed = input.startsWith('[') && input.endsWith(']');
  const inner = bracketed ? input.slice(1, -1) : input;
  if (inner.includes(':')) {
    if (!IPV6_CHARS.test(inner)) return undefined;
    return hostnameOf(`http://[${inner}]/`)?.replace(/^\[|\]$/g, '');
  }
  if (bracketed || !IPV4_CHARS.test(inner)) return undefined;
  const host = hostnameOf(`http://${inner}/`);
  return host !== undefined && DOTTED_QUAD.test(host) ? host : undefined;
}

function hostnameOf(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

/** Eight 16-bit groups of a canonical IPv6 text, or undefined when it does not parse. */
function ipv6Groups(text: string): number[] | undefined {
  if (!/^[0-9a-f:]+$/.test(text)) return undefined;
  const halves = text.split('::');
  if (halves.length > 2) return undefined;
  const parse = (part: string): number[] | undefined => {
    if (part === '') return [];
    const groups = part
      .split(':')
      .map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? parseInt(group, 16) : NaN));
    return groups.some(Number.isNaN) ? undefined : groups;
  };
  const head = parse(halves[0] ?? '');
  const tail = halves.length === 2 ? parse(halves[1] ?? '') : [];
  if (!head || !tail) return undefined;
  if (halves.length === 1) return head.length === 8 ? head : undefined;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return undefined;
  return [...head, ...Array<number>(missing).fill(0), ...tail];
}

function ipv4Public(a: number, b: number, c: number, allowLoopback: boolean): boolean {
  if (a === 127) return allowLoopback;
  if (a === 0 || a === 10 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT 100.64.0.0/10
  if (a === 169 && b === 254) return false; // link-local and cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // IETF protocol, TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return false; // 6to4 relay anycast
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && c === 100) return false; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false; // TEST-NET-3
  return true;
}

/** IPv4 embedded in two 16-bit groups (mapped, NAT64 and 6to4): never a loopback exception. */
function embeddedPublic(high: number, low: number): boolean {
  return ipv4Public(high >> 8, high & 0xff, low >> 8, false);
}

function ipv6Public(w: number[], allowLoopback: boolean): boolean {
  const [w0 = 0, w1 = 0, w2 = 0, w3 = 0, w4 = 0, w5 = 0, w6 = 0, w7 = 0] = w;
  const zeroThrough = (count: number): boolean => w.slice(0, count).every((group) => group === 0);
  if (zeroThrough(7) && w7 === 1) return allowLoopback; // ::1
  if (zeroThrough(6)) return false; // :: and the deprecated IPv4-compatible ::/96
  if (zeroThrough(5) && w5 === 0xffff) return embeddedPublic(w6, w7); // ::ffff:0:0/96
  if (w0 === 0x64 && w1 === 0xff9b) {
    if (w2 === 0 && w3 === 0 && w4 === 0 && w5 === 0) return embeddedPublic(w6, w7); // NAT64
    return false; // 64:ff9b:1::/48 and the rest of 64:ff9b::/32
  }
  if ((w0 & 0xe000) !== 0x2000) return false; // outside global unicast 2000::/3
  if (w0 === 0x2001 && w1 < 0x0200) return false; // 2001::/23: IETF protocol, Teredo
  if (w0 === 0x2001 && w1 === 0x0db8) return false; // documentation
  if (w0 === 0x2002) return embeddedPublic(w1, w2); // 6to4
  if (w0 === 0x3fff && w1 < 0x1000) return false; // documentation 3fff::/20
  return true;
}

/**
 * True when the address (any literal form) is public. A text that is not an IP literal is not
 * public: a host name must be resolved first and every answer checked.
 */
export function isPublicAddress(input: string, options: AddressOptions = {}): boolean {
  const canonical = normalizeIpLiteral(input);
  if (canonical === undefined) return false;
  const allowLoopback = options.allowLoopback === true;
  const quad = DOTTED_QUAD.exec(canonical);
  if (quad) {
    const [a, b, c] = [Number(quad[1]), Number(quad[2]), Number(quad[3])];
    return ipv4Public(a, b, c, allowLoopback);
  }
  const groups = ipv6Groups(canonical);
  return groups !== undefined && ipv6Public(groups, allowLoopback);
}
