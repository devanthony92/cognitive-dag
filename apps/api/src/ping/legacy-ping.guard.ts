import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { FEATURE_FLAGS } from '@cognitive-dag/contracts';
import { FlagsService } from '../flags/flags.service';

/**
 * The F0 ping routes exist only while `identity-enabled` is off. Once on, pings live under
 * /organizations/{id}/pings and need a session, so the old route disappears (R7, FR-021).
 */
@Injectable()
export class LegacyPingGuard implements CanActivate {
  constructor(private readonly flags: FlagsService) {}

  async canActivate(): Promise<boolean> {
    if (await this.flags.isEnabled(FEATURE_FLAGS.identityEnabled)) throw new NotFoundException();
    return true;
  }
}
