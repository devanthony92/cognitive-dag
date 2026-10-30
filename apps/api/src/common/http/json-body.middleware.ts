import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import { json, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env.schema';

/** `PUT /api/v1/organizations/{id}/workflows/{id}/draft`: the only route with a larger body. */
const DRAFT_PATH = /^\/api\/v1\/organizations\/[^/]+\/workflows\/[^/]+\/draft\/?$/;
const DRAFT_ENVELOPE_SLACK = 1024;

/**
 * JSON body parsing as Nest middleware (instead of Nest's built-in parser) so that parse and
 * size errors run after the correlation middleware and reach ProblemDetailsFilter.
 */
@Injectable()
export class JsonBodyMiddleware implements NestMiddleware {
  private readonly parser: RequestHandler;
  private readonly draftParser: RequestHandler;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.parser = json({ limit: config.BODY_LIMIT });
    // A draft may be as large as the biggest limit an organization can have; the service checks
    // the real limit of the organization (FR-020). The slack covers the JSON envelope.
    this.draftParser = json({
      limit: config.DAG_MAX_DEFINITION_BYTES_CEILING + DRAFT_ENVELOPE_SLACK,
    });
  }

  use(req: Request, res: Response, next: NextFunction): void {
    const parser =
      req.method === 'PUT' && DRAFT_PATH.test(req.path) ? this.draftParser : this.parser;
    parser(req, res, next);
  }
}
