import { CanActivate, Injectable } from '@nestjs/common';
import { FEATURE_FLAGS } from '@cognitive-dag/contracts';
import { FeatureNotAvailableException } from '../common/errors/domain.exception';
import { FlagsService } from '../flags/flags.service';

/**
 * Gates every F1 endpoint behind `identity-enabled` (FR-033). It runs before body validation, so
 * with the flag off even an invalid request answers 404 FEATURE_NOT_AVAILABLE.
 */
@Injectable()
export class IdentityEnabledGuard implements CanActivate {
  constructor(private readonly flags: FlagsService) {}

  async canActivate(): Promise<boolean> {
    if (!(await this.flags.isEnabled(FEATURE_FLAGS.identityEnabled))) {
      throw new FeatureNotAvailableException();
    }
    return true;
  }
}
