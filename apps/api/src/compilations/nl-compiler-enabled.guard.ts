import { CanActivate, Injectable } from '@nestjs/common';
import { FEATURE_FLAGS } from '@cognitive-dag/contracts';
import { FeatureNotAvailableException } from '../common/errors/domain.exception';
import { FlagsService } from '../flags/flags.service';

/**
 * Gates every endpoint of the compiler behind `nl-compiler-enabled` (F6, FR-015). It is a release
 * switch, not an access control: the organization guard and the roles apply with the flag on.
 */
@Injectable()
export class NlCompilerEnabledGuard implements CanActivate {
  constructor(private readonly flags: FlagsService) {}

  async canActivate(): Promise<boolean> {
    if (!(await this.flags.isEnabled(FEATURE_FLAGS.nlCompilerEnabled))) {
      throw new FeatureNotAvailableException();
    }
    return true;
  }
}
