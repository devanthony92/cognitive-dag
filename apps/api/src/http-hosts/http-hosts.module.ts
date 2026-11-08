import { Module } from '@nestjs/common';
import { IdentityEnabledGuard } from '../auth/identity-enabled.guard';
import { OrganizationsModule } from '../organizations/organizations.module';
import { TriggersEnabledGuard } from '../triggers/triggers-enabled.guard';
import { HttpHostsController } from './http-hosts.controller';
import { HttpHostsService } from './http-hosts.service';

@Module({
  imports: [OrganizationsModule],
  controllers: [HttpHostsController],
  providers: [HttpHostsService, IdentityEnabledGuard, TriggersEnabledGuard],
})
export class HttpHostsModule {}
