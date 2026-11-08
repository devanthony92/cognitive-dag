import {
  CredentialCryptoError,
  buildCredentialHeader,
  decryptSecret,
} from '@cognitive-dag/connectors';
import {
  and,
  credentials,
  eq,
  httpAllowedHosts,
  isNull,
  type WithContext,
} from '@cognitive-dag/db';
import { NodeFailure } from '../resilience/attempts';

/** Message of every credential failure: it never says which of the reasons it was. */
const UNAVAILABLE_MESSAGE = 'La credencial no está disponible.';

export interface CredentialHeader {
  name: string;
  value: string;
}

export interface CredentialResolver {
  /**
   * Decrypts the credential and returns the one header it adds to a request. The secret never leaves
   * this call: it is not returned, logged or written to the history of Temporal. A credential that
   * is archived, missing or of another organization is the same permanent failure.
   */
  headerFor(organizationId: string, credentialId: string): Promise<CredentialHeader>;
  /** The live patterns of the allowlist of the organization; empty means no restriction. */
  allowlistFor(organizationId: string): Promise<string[]>;
}

export interface CredentialResolverOptions {
  withContext: WithContext;
  /** `CREDENTIALS_MASTER_KEY` decoded; absent outside production when it is not configured. */
  masterKey: Buffer | undefined;
}

function unavailable(code = 'CREDENTIAL_UNAVAILABLE', message = UNAVAILABLE_MESSAGE): NodeFailure {
  return new NodeFailure({ errorClass: 'permanent', code, message });
}

export function createCredentialResolver(options: CredentialResolverOptions): CredentialResolver {
  return {
    async headerFor(organizationId, credentialId) {
      if (!options.masterKey) {
        throw unavailable(
          'CREDENTIALS_NOT_CONFIGURED',
          'El servidor no tiene una llave maestra de credenciales válida.',
        );
      }
      const [row] = await options.withContext({ organizationId }, (tx) =>
        tx
          .select()
          .from(credentials)
          .where(
            and(
              eq(credentials.id, credentialId),
              eq(credentials.organizationId, organizationId),
              isNull(credentials.archivedAt),
            ),
          ),
      );
      if (!row) throw unavailable();
      try {
        const secret = decryptSecret({
          credentialId: row.id,
          organizationId: row.organizationId,
          masterKey: options.masterKey,
          encrypted: {
            dekWrapped: row.dekWrapped,
            dekIv: row.dekIv,
            dekTag: row.dekTag,
            secretCt: row.secretCt,
            secretIv: row.secretIv,
            secretTag: row.secretTag,
            keyVersion: row.keyVersion,
          },
        });
        return buildCredentialHeader({
          kind: row.kind,
          headerName: row.headerName,
          secret,
        });
      } catch (error) {
        if (error instanceof CredentialCryptoError) throw unavailable();
        throw error;
      }
    },
    async allowlistFor(organizationId) {
      const rows = await options.withContext({ organizationId }, (tx) =>
        tx
          .select({ pattern: httpAllowedHosts.pattern })
          .from(httpAllowedHosts)
          .where(
            and(
              eq(httpAllowedHosts.organizationId, organizationId),
              isNull(httpAllowedHosts.removedAt),
            ),
          ),
      );
      return rows.map((row) => row.pattern);
    },
  };
}
