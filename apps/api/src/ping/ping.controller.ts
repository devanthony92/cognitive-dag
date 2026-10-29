import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ClsService } from 'nestjs-cls';
import type { PingExecution } from '@cognitive-dag/contracts';
import { Public } from '../auth/public.decorator';
import { FlagsService } from '../flags/flags.service';
import { LegacyPingGuard } from './legacy-ping.guard';
import { createPing } from './ping-create';
import { CreatePingDto, PingParamsDto } from './ping.dto';
import { PingService } from './ping.service';

/** F0 route, available only with `identity-enabled` off (see LegacyPingGuard). */
@Controller('api/v1/pings')
@Public()
@UseGuards(LegacyPingGuard)
export class PingController {
  constructor(
    private readonly pings: PingService,
    private readonly flags: FlagsService,
    private readonly cls: ClsService,
  ) {}

  @Post()
  @HttpCode(202)
  async create(
    @Body() body: CreatePingDto,
    @Headers() rawHeaders: Record<string, unknown>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PingExecution> {
    const ping = await createPing(
      { pings: this.pings, flags: this.flags, cls: this.cls },
      { rawHeaders, message: body.message },
    );
    res.location(`/api/v1/pings/${ping.pingId}`);
    return ping;
  }

  @Get(':pingId')
  get(@Param() params: PingParamsDto): Promise<PingExecution> {
    return this.pings.get(params.pingId);
  }
}
