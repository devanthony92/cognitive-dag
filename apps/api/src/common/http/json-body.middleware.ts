import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import { json, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env.schema';

/**
 * JSON body parsing as Nest middleware (instead of Nest's built-in parser) so that parse and
 * size errors run after the correlation middleware and reach ProblemDetailsFilter.
 */
@Injectable()
export class JsonBodyMiddleware implements NestMiddleware {
  private readonly parser: RequestHandler;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.parser = json({ limit: config.BODY_LIMIT });
  }

  use(req: Request, res: Response, next: NextFunction): void {
    this.parser(req, res, next);
  }
}
