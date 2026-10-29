import { Controller, Get } from '@nestjs/common';
import type { PublicFeatures } from '@cognitive-dag/contracts';
import { FlagsService } from './flags.service';

@Controller('api/v1/features')
export class FeaturesController {
  constructor(private readonly flags: FlagsService) {}

  @Get()
  features(): Promise<PublicFeatures> {
    return this.flags.publicFeatures();
  }
}
