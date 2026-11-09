import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { HttpHostsController } from './http-hosts.controller';
import { HttpHostsService } from './http-hosts.service';

@Module({
  imports: [OrganizationsModule],
  controllers: [HttpHostsController],
  providers: [HttpHostsService],
})
export class HttpHostsModule {}
