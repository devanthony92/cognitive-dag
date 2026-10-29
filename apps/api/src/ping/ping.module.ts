import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { LegacyPingGuard } from './legacy-ping.guard';
import { OrganizationPingController } from './organization-ping.controller';
import { PingController } from './ping.controller';
import { PingService } from './ping.service';

@Module({
  imports: [OrganizationsModule],
  controllers: [PingController, OrganizationPingController],
  providers: [LegacyPingGuard, PingService],
})
export class PingModule {}
