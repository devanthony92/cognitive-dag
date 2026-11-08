import { Inject, Injectable } from '@nestjs/common';
import {
  active,
  and,
  credentials,
  eq,
  findCredentialMetadata,
  inArray,
  listCredentialMetadata,
  newId,
  users,
  type DatabaseClient,
  type Tx,
} from '@cognitive-dag/db';
import { encryptSecret } from '@cognitive-dag/connectors';
import type {
  CreateCredentialRequest,
  Credential,
  CredentialList,
  RotateCredentialRequest,
} from '@cognitive-dag/contracts';
import { isUniqueViolation } from '../auth/pg-errors';
import { DomainException, ResourceNotFoundException } from '../common/errors/domain.exception';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/env.schema';
import { DATABASE } from '../database/database.module';
import { SecurityEventLogger } from '../security-events/security-event.logger';

const NAME_KEY = 'credentials_organization_name_active_key';
const UNKNOWN_PERSON = 'Usuario desconocido';

export interface CredentialActor {
  userId: string;
  organizationId: string;
  ip: string;
}

type MetadataRow = Awaited<ReturnType<typeof listCredentialMetadata>>[number];

/**
 * Credentials of the organization (F7, decisions 10B). The secret enters on create and rotate,
 * leaves encrypted into the row, and never comes back: every read here goes through the metadata
 * projection, which has no secret column to leak.
 */
@Injectable()
export class CredentialsService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly events: SecurityEventLogger,
  ) {}

  private context(actor: CredentialActor) {
    return { userId: actor.userId, organizationId: actor.organizationId };
  }

  /** Creating and rotating need the master key; without it the server answers 503 (not a guess). */
  private masterKey(): Buffer {
    const key = this.config.credentialsMasterKey;
    if (!key) {
      throw new DomainException(
        503,
        'CREDENTIALS_NOT_CONFIGURED',
        'El servidor no tiene configurada la llave de cifrado de credenciales.',
      );
    }
    return key;
  }

  list(actor: CredentialActor): Promise<CredentialList> {
    return this.database.withContext(this.context(actor), async (tx) => {
      const rows = await listCredentialMetadata(tx, actor.organizationId);
      const names = await personNames(
        tx,
        rows.map((row) => row.createdBy),
      );
      return { items: rows.map((row) => toCredential(row, names)) };
    });
  }

  async create(actor: CredentialActor, request: CreateCredentialRequest): Promise<Credential> {
    const masterKey = this.masterKey();
    const created = await this.database.withContext(this.context(actor), async (tx) => {
      // The id is part of what the secret is bound to, so it exists before the insert.
      const id = await newId(tx);
      const encrypted = encryptSecret({
        credentialId: id,
        organizationId: actor.organizationId,
        masterKey,
        secret: request.secret,
      });
      try {
        await tx.insert(credentials).values({
          id,
          organizationId: actor.organizationId,
          name: request.name,
          kind: request.kind,
          headerName: request.kind === 'api_key_header' ? (request.headerName ?? null) : null,
          ...encrypted,
          createdBy: actor.userId,
        });
      } catch (error) {
        if (isUniqueViolation(error, NAME_KEY)) {
          throw new DomainException(
            409,
            'CREDENTIAL_NAME_TAKEN',
            'Ya existe una credencial vigente con ese nombre.',
          );
        }
        throw error;
      }
      return this.read(tx, actor, id);
    });
    this.emit('credential.created', actor, created.id);
    return created;
  }

  async rotate(
    actor: CredentialActor,
    credentialId: string,
    request: RotateCredentialRequest,
  ): Promise<Credential> {
    const masterKey = this.masterKey();
    const rotated = await this.database.withContext(this.context(actor), async (tx) => {
      const current = await this.find(tx, actor, credentialId);
      if (current.archivedAt !== null) {
        throw new DomainException(409, 'CREDENTIAL_ARCHIVED', 'La credencial está archivada.');
      }
      const encrypted = encryptSecret({
        credentialId,
        organizationId: actor.organizationId,
        masterKey,
        secret: request.secret,
      });
      await tx
        .update(credentials)
        .set({ ...encrypted, rotatedBy: actor.userId, rotatedAt: new Date() })
        .where(
          and(
            eq(credentials.id, credentialId),
            eq(credentials.organizationId, actor.organizationId),
          ),
        );
      return this.read(tx, actor, credentialId);
    });
    this.emit('credential.rotated', actor, credentialId);
    return rotated;
  }

  async archive(actor: CredentialActor, credentialId: string): Promise<void> {
    await this.database.withContext(this.context(actor), async (tx) => {
      const current = await this.find(tx, actor, credentialId);
      // Archiving twice is the same end state; the credential stays archived.
      if (current.archivedAt !== null) return;
      await tx
        .update(credentials)
        .set({ archivedBy: actor.userId, archivedAt: new Date() })
        .where(
          and(
            eq(credentials.id, credentialId),
            eq(credentials.organizationId, actor.organizationId),
          ),
        );
    });
    this.emit('credential.archived', actor, credentialId);
  }

  private async find(tx: Tx, actor: CredentialActor, credentialId: string) {
    const [row] = await findCredentialMetadata(tx, actor.organizationId, credentialId);
    if (!row) throw new ResourceNotFoundException();
    return row;
  }

  private async read(tx: Tx, actor: CredentialActor, credentialId: string): Promise<Credential> {
    const row = await this.find(tx, actor, credentialId);
    const names = await personNames(tx, [row.createdBy]);
    return toCredential(row, names);
  }

  private emit(
    event: 'credential.created' | 'credential.rotated' | 'credential.archived',
    actor: CredentialActor,
    credentialId: string,
  ): void {
    this.events.emit({
      event,
      outcome: 'success',
      userId: actor.userId,
      organizationId: actor.organizationId,
      ip: actor.ip,
      resourceId: credentialId,
    });
  }
}

async function personNames(tx: Tx, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await active.users(tx, inArray(users.id, unique));
  return new Map(rows.map((row) => [row.id, row.name]));
}

function toCredential(row: MetadataRow, names: Map<string, string>): Credential {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    headerName: row.headerName,
    createdAt: row.createdAt.toISOString(),
    createdBy: { id: row.createdBy, name: names.get(row.createdBy) ?? UNKNOWN_PERSON },
    rotatedAt: row.rotatedAt?.toISOString() ?? null,
  };
}
