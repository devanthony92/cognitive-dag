import { Module } from '@nestjs/common';
import { IdentityEnabledGuard } from '../auth/identity-enabled.guard';
import { InvitationLinksController, InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { MembershipService } from './membership.service';
import { OrganizationGuard } from './organization.guard';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';

@Module({
  controllers: [
    OrganizationsController,
    MembersController,
    InvitationsController,
    InvitationLinksController,
  ],
  providers: [
    IdentityEnabledGuard,
    InvitationsService,
    MembersService,
    MembershipService,
    OrganizationGuard,
    OrganizationsService,
  ],
  exports: [IdentityEnabledGuard, MembershipService, OrganizationGuard, OrganizationsService],
})
export class OrganizationsModule {}
