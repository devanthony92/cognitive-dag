import { CanActivate, Injectable } from '@nestjs/common';
import { FEATURE_FLAGS } from '@cognitive-dag/contracts';
import { FeatureNotAvailableException } from '../common/errors/domain.exception';
import { FlagsService } from '../flags/flags.service';

/**
 * Gates every F2 endpoint behind `dag-editor-enabled` (FR-025). It is a release switch, not an
 * access control: the organization guard and the roles apply with the flag on.
 */
@Injectable()
export class DagEditorEnabledGuard implements CanActivate {
  constructor(private readonly flags: FlagsService) {}

  async canActivate(): Promise<boolean> {
    if (!(await this.flags.isEnabled(FEATURE_FLAGS.dagEditorEnabled))) {
      throw new FeatureNotAvailableException();
    }
    return true;
  }
}
