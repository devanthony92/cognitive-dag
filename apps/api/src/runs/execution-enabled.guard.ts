import { CanActivate, Injectable } from '@nestjs/common';
import { FEATURE_FLAGS } from '@cognitive-dag/contracts';
import { FeatureNotAvailableException } from '../common/errors/domain.exception';
import { FlagsService } from '../flags/flags.service';

/**
 * Gates every F3 endpoint behind `execution-enabled` (FR-020). It is a release switch, not an
 * access control: the organization guard applies with the flag on.
 */
@Injectable()
export class ExecutionEnabledGuard implements CanActivate {
  constructor(private readonly flags: FlagsService) {}

  async canActivate(): Promise<boolean> {
    if (!(await this.flags.isEnabled(FEATURE_FLAGS.executionEnabled))) {
      throw new FeatureNotAvailableException();
    }
    return true;
  }
}
