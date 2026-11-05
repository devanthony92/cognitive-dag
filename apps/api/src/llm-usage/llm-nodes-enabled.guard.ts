import { CanActivate, Injectable } from '@nestjs/common';
import { FEATURE_FLAGS } from '@cognitive-dag/contracts';
import { FeatureNotAvailableException } from '../common/errors/domain.exception';
import { FlagsService } from '../flags/flags.service';

/** Gates the LLM usage endpoint behind `llm-nodes-enabled` (F5, research R13). */
@Injectable()
export class LlmNodesEnabledGuard implements CanActivate {
  constructor(private readonly flags: FlagsService) {}

  async canActivate(): Promise<boolean> {
    if (!(await this.flags.isEnabled(FEATURE_FLAGS.llmNodesEnabled))) {
      throw new FeatureNotAvailableException();
    }
    return true;
  }
}
