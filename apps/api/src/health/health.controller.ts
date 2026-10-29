import { Controller, Get, Res } from '@nestjs/common';
import type { HealthIndicatorResult } from '@nestjs/terminus';
import type { Response } from 'express';
import type { HealthReport } from '@cognitive-dag/contracts';
import { DependencyIndicators } from './dependency.indicators';

@Controller('health')
export class HealthController {
  constructor(private readonly indicators: DependencyIndicators) {}

  @Get('live')
  live(): HealthReport {
    return { status: 'ok' };
  }

  /** 200 when every dependency is up, 503 otherwise. Never includes internal error messages. */
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response): Promise<HealthReport> {
    const results = await Promise.all([
      this.indicators.postgres(),
      this.indicators.valkeyPing(),
      this.indicators.temporalHealth(),
    ]);
    const checks = Object.fromEntries(
      results.flatMap((result: HealthIndicatorResult) =>
        Object.entries(result).map(([key, value]) => [
          key,
          { status: value.status === 'up' ? ('up' as const) : ('down' as const) },
        ]),
      ),
    );
    const allUp = Object.values(checks).every((check) => check.status === 'up');
    res.status(allUp ? 200 : 503);
    return { status: allUp ? 'ok' : 'error', checks };
  }
}
