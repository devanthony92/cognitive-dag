import { CanActivate, Injectable } from '@nestjs/common';
import { FEATURE_FLAGS } from '@cognitive-dag/contracts';
import { FeatureNotAvailableException } from '../common/errors/domain.exception';
import { FlagsService } from '../flags/flags.service';

/**
 * Gates every F7 endpoint, the public webhook included, behind `triggers-enabled` (decision 13C).
 * It is a release switch, not an access control: the organization guard still applies.
 */
@Injectable()
export class TriggersEnabledGuard implements CanActivate {
  constructor(private readonly flags: FlagsService) {}

  async canActivate(): Promise<boolean> {
    if (!(await this.flags.isEnabled(FEATURE_FLAGS.triggersEnabled))) {
      throw new FeatureNotAvailableException();
    }
    return true;
  }
}
