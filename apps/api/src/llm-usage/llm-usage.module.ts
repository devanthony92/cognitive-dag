import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { LlmUsageController } from './llm-usage.controller';
import { LlmUsageService } from './llm-usage.service';

@Module({
  imports: [OrganizationsModule],
  controllers: [LlmUsageController],
  providers: [LlmUsageService],
})
export class LlmUsageModule {}
