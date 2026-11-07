/** How the caller should treat a failure (taxonomy of F4, docs/PLAN.md §5.1). */
export type ConnectorErrorClass = 'transient' | 'timeout' | 'permanent';

/** Message of every block on the destination: it never says which rule fired (research R9.9). */
export const DESTINATION_BLOCKED_MESSAGE = 'El destino no está permitido.';

/**
 * Failure of the outbound HTTP client. `message` is safe to show: it never carries the URL, the
 * resolved address, the response body or any secret (research R11).
 */
export class ConnectorError extends Error {
  readonly code: string;
  readonly errorClass: ConnectorErrorClass;

  constructor(
    code: string,
    errorClass: ConnectorErrorClass,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ConnectorError';
    this.code = code;
    this.errorClass = errorClass;
  }
}

/** The destination resolves, or is written, as a non-public address (research R9.1-R9.4). */
export class SsrfError extends ConnectorError {
  constructor() {
    super('SSRF_BLOCKED_ADDRESS', 'permanent', DESTINATION_BLOCKED_MESSAGE);
    this.name = 'SsrfError';
  }
}

/** The envelope encryption or the credential header could not be produced (research R10). */
export class CredentialCryptoError extends ConnectorError {
  constructor(code: string, message: string) {
    super(code, 'permanent', message);
    this.name = 'CredentialCryptoError';
  }
}

/** Codes the HTTP client can fail with. `@cognitive-dag/contracts` lists them for the steps. */
export const HTTP_CLIENT_ERROR_CODES = [
  'SSRF_BLOCKED_ADDRESS',
  'HTTP_HOST_NOT_ALLOWED',
  'HTTP_REDIRECT_NOT_ALLOWED',
  'HTTP_TOO_MANY_REDIRECTS',
  'HTTP_RESPONSE_TOO_LARGE',
  'HTTP_CONTENT_TYPE_UNSUPPORTED',
  'HTTP_URL_INVALID',
  'HTTP_HEADER_FORBIDDEN',
  'HTTP_TLS_ERROR',
  'HTTP_NETWORK_ERROR',
  'HTTP_TIMEOUT',
] as const;
