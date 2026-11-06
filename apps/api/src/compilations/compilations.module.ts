import { Module } from '@nestjs/common';
import { IdentityEnabledGuard } from '../auth/identity-enabled.guard';
import { OrganizationsModule } from '../organizations/organizations.module';
import { RunTemporalService } from '../runs/run-history.service';
import { CompilationsController } from './compilations.controller';
import { CompilationsService } from './compilations.service';
import { CompilerRateLimiter } from './compiler-rate-limiter';
import { NlCompilerEnabledGuard } from './nl-compiler-enabled.guard';

@Module({
  imports: [OrganizationsModule],
  controllers: [CompilationsController],
  providers: [
    CompilationsService,
    CompilerRateLimiter,
    IdentityEnabledGuard,
    NlCompilerEnabledGuard,
    RunTemporalService,
  ],
})
export class CompilationsModule {}
