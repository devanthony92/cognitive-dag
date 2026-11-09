import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { RunTemporalService } from '../runs/run-history.service';
import { CompilationsController } from './compilations.controller';
import { CompilationsService } from './compilations.service';
import { CompilerRateLimiter } from './compiler-rate-limiter';

@Module({
  imports: [OrganizationsModule],
  controllers: [CompilationsController],
  providers: [CompilationsService, CompilerRateLimiter, RunTemporalService],
})
export class CompilationsModule {}
