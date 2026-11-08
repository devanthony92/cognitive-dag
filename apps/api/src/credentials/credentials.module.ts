import { Module } from '@nestjs/common';
import { IdentityEnabledGuard } from '../auth/identity-enabled.guard';
import { OrganizationsModule } from '../organizations/organizations.module';
import { TriggersEnabledGuard } from '../triggers/triggers-enabled.guard';
import { CredentialsController } from './credentials.controller';
import { CredentialsService } from './credentials.service';

@Module({
  imports: [OrganizationsModule],
  controllers: [CredentialsController],
  providers: [CredentialsService, IdentityEnabledGuard, TriggersEnabledGuard],
})
export class CredentialsModule {}
