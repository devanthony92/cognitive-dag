import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, httpAllowedHosts, isNull, type DatabaseClient } from '@cognitive-dag/db';
import { validateAllowlistEntry } from '@cognitive-dag/connectors';
import type { HttpAllowedHost, HttpAllowedHostList } from '@cognitive-dag/contracts';
import { isCheckViolation, isUniqueViolation } from '../auth/pg-errors';
import { DomainException, ResourceNotFoundException } from '../common/errors/domain.exception';
import { DATABASE } from '../database/database.module';
import { SecurityEventLogger } from '../security-events/security-event.logger';

const PATTERN_KEY = 'http_allowed_hosts_organization_pattern_active_key';
const LIMIT_CHECK = 'http_allowed_hosts_limit';

export interface HttpHostActor {
  userId: string;
  organizationId: string;
  ip: string;
}

type HostRow = typeof httpAllowedHosts.$inferSelect;

const toHost = (row: HostRow): HttpAllowedHost => ({
  id: row.id,
  pattern: row.pattern,
  createdAt: row.createdAt.toISOString(),
});

/** The optional allowlist of destinations of an organization (F7, decision 9C). */
@Injectable()
export class HttpHostsService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseClient,
    private readonly events: SecurityEventLogger,
  ) {}

  private context(actor: HttpHostActor) {
    return { userId: actor.userId, organizationId: actor.organizationId };
  }

  list(actor: HttpHostActor): Promise<HttpAllowedHostList> {
    return this.database.withContext(this.context(actor), async (tx) => {
      const rows = await tx
        .select()
        .from(httpAllowedHosts)
        .where(
          and(
            eq(httpAllowedHosts.organizationId, actor.organizationId),
            isNull(httpAllowedHosts.removedAt),
          ),
        )
        .orderBy(asc(httpAllowedHosts.pattern));
      return { items: rows.map(toHost) };
    });
  }

  async add(actor: HttpHostActor, pattern: string): Promise<HttpAllowedHost> {
    // The grammar is the one the client applies to every destination: one source of truth.
    const checked = validateAllowlistEntry(pattern);
    if (!checked.ok) {
      throw new DomainException(422, 'VALIDATION_FAILED', 'La entrada no es válida.', {
        errors: [{ field: 'pattern', message: checked.reason }],
      });
    }
    const row = await this.database.withContext(this.context(actor), async (tx) => {
      try {
        const [inserted] = await tx
          .insert(httpAllowedHosts)
          .values({
            organizationId: actor.organizationId,
            pattern: checked.pattern,
            createdBy: actor.userId,
          })
          .returning();
        if (!inserted) throw new Error('INSERT INTO http_allowed_hosts returned no row');
        return inserted;
      } catch (error) {
        if (isUniqueViolation(error, PATTERN_KEY)) {
          throw new DomainException(409, 'HTTP_HOST_EXISTS', 'Esa entrada ya está en la lista.');
        }
        if (isCheckViolation(error, LIMIT_CHECK)) {
          throw new DomainException(
            422,
            'HTTP_HOST_LIMIT_REACHED',
            'La lista ya tiene el máximo de 100 entradas. Retira alguna antes de agregar otra.',
          );
        }
        throw error;
      }
    });
    this.events.emit({
      event: 'http_host.added',
      outcome: 'success',
      userId: actor.userId,
      organizationId: actor.organizationId,
      ip: actor.ip,
      resourceId: row.id,
    });
    return toHost(row);
  }

  async remove(actor: HttpHostActor, hostId: string): Promise<void> {
    await this.database.withContext(this.context(actor), async (tx) => {
      const removed = await tx
        .update(httpAllowedHosts)
        .set({ removedBy: actor.userId, removedAt: new Date() })
        .where(
          and(
            eq(httpAllowedHosts.id, hostId),
            eq(httpAllowedHosts.organizationId, actor.organizationId),
            isNull(httpAllowedHosts.removedAt),
          ),
        )
        .returning({ id: httpAllowedHosts.id });
      if (removed.length === 0) throw new ResourceNotFoundException();
    });
    this.events.emit({
      event: 'http_host.removed',
      outcome: 'success',
      userId: actor.userId,
      organizationId: actor.organizationId,
      ip: actor.ip,
      resourceId: hostId,
    });
  }
}
