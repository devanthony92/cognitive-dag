import { Controller, Get, Inject, Module, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { active, eq, memberships, organizations, type DatabaseClient } from '@cognitive-dag/db';
import { CurrentAuth, CurrentTenant } from '../../../src/auth/request-context';
import type { AuthSession } from '../../../src/auth/session.service';
import { DATABASE } from '../../../src/database/database.module';
import { OrganizationGuard } from '../../../src/organizations/organization.guard';
import { OrganizationsModule } from '../../../src/organizations/organizations.module';
import { tenantContextOf, type RequestTenant } from '../../../src/organizations/tenant-context';

/**
 * Test-only endpoints that behave like application code with the organization filter forgotten:
 * they read and write without any `WHERE organization_id`, and they may even aim a write at an
 * organization named in the query string. Only row-level security stands between them and the data.
 */
@Controller('api/v1/organizations/:organizationId/probe')
@UseGuards(OrganizationGuard)
export class TenantProbeController {
  constructor(@Inject(DATABASE) private readonly database: DatabaseClient) {}

  @Get('memberships')
  async readMemberships(
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant | undefined,
  ): Promise<{ organizationIds: string[] }> {
    const rows = await this.database.withContext(tenantContextOf(auth, tenant), (tx) =>
      active.memberships(tx),
    );
    return { organizationIds: rows.map((row) => row.organizationId) };
  }

  @Get('organizations')
  async readOrganizations(
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant | undefined,
  ): Promise<{ organizationIds: string[] }> {
    const rows = await this.database.withContext(tenantContextOf(auth, tenant), (tx) =>
      active.organizations(tx),
    );
    return { organizationIds: rows.map((row) => row.id) };
  }

  @Post('membership')
  async writeMembership(
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant | undefined,
    @Query('target') target: string,
  ): Promise<{ written: boolean }> {
    try {
      await this.database.withContext(tenantContextOf(auth, tenant), (tx) =>
        tx
          .insert(memberships)
          .values({ organizationId: target, userId: auth.userId, role: 'owner' }),
      );
      return { written: true };
    } catch {
      return { written: false };
    }
  }

  @Patch('organization')
  async renameOrganization(
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant | undefined,
    @Query('target') target: string,
  ): Promise<{ updated: number }> {
    try {
      const rows = await this.database.withContext(tenantContextOf(auth, tenant), (tx) =>
        tx
          .update(organizations)
          .set({ name: 'Renombrada por la sonda' })
          .where(eq(organizations.id, target))
          .returning({ id: organizations.id }),
      );
      return { updated: rows.length };
    } catch {
      return { updated: 0 };
    }
  }
}

@Module({ imports: [OrganizationsModule], controllers: [TenantProbeController] })
export class TenantProbeModule {}
