import { Body, Controller, Get, Headers, HttpCode, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { ZodValidationException } from 'nestjs-zod';
import { FEATURE_FLAGS, resolveCorrelationId, type PingExecution } from '@cognitive-dag/contracts';
import { DomainException } from '../common/errors/domain.exception';
import { FlagsService } from '../flags/flags.service';
import { CreatePingDto, CreatePingHeadersSchema, PingParamsDto } from './ping.dto';
import { PingService } from './ping.service';

@Controller('api/v1/pings')
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
    // Nest pipes skip @Headers(), so the header is validated here and reported as 422.
    const headers = CreatePingHeadersSchema.safeParse(rawHeaders);
    if (!headers.success) throw new ZodValidationException(headers.error);
    // The flag gates the feature before any workflow starts (constitution, principle VIII).
    if (!(await this.flags.isEnabled(FEATURE_FLAGS.pingEnabled))) {
      throw new DomainException(
        404,
        'FEATURE_NOT_AVAILABLE',
        'Esta funcionalidad no está disponible.',
      );
    }
    const ping = await this.pings.create({
      correlationId: resolveCorrelationId(this.cls.getId()),
      message: body.message,
      idempotencyKey: headers.data['idempotency-key'],
    });
    res.location(`/api/v1/pings/${ping.pingId}`);
    return ping;
  }

  @Get(':pingId')
  get(@Param() params: PingParamsDto): Promise<PingExecution> {
    return this.pings.get(params.pingId);
  }
}
