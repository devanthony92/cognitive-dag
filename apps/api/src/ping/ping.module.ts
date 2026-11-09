import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { OrganizationPingController } from './organization-ping.controller';
import { PingService } from './ping.service';

@Module({
  imports: [OrganizationsModule],
  controllers: [OrganizationPingController],
  providers: [PingService],
})
export class PingModule {}
