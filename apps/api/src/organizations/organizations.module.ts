import { Module } from '@nestjs/common';
import { IdentityEnabledGuard } from '../auth/identity-enabled.guard';
import { MembershipService } from './membership.service';
import { OrganizationGuard } from './organization.guard';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';

@Module({
  controllers: [OrganizationsController],
  providers: [IdentityEnabledGuard, MembershipService, OrganizationGuard, OrganizationsService],
  exports: [IdentityEnabledGuard, MembershipService, OrganizationGuard, OrganizationsService],
})
export class OrganizationsModule {}
