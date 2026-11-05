import { Module } from '@nestjs/common';
import { IdentityEnabledGuard } from '../auth/identity-enabled.guard';
import { OrganizationsModule } from '../organizations/organizations.module';
import { LlmNodesEnabledGuard } from './llm-nodes-enabled.guard';
import { LlmUsageController } from './llm-usage.controller';
import { LlmUsageService } from './llm-usage.service';

@Module({
  imports: [OrganizationsModule],
  controllers: [LlmUsageController],
  providers: [IdentityEnabledGuard, LlmNodesEnabledGuard, LlmUsageService],
})
export class LlmUsageModule {}
