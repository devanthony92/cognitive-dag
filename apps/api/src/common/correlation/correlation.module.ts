import type { IncomingMessage, ServerResponse } from 'node:http';
import { Module } from '@nestjs/common';
import { ClsModule, type ClsService } from 'nestjs-cls';
import { CORRELATION_ID_HEADER, resolveCorrelationId } from '@cognitive-dag/contracts';

/**
 * Correlation-ID per request (constitution, principle VI). The CLS id is the correlation id:
 * a valid incoming X-Correlation-Id is reused, anything else is replaced by a new UUID.
 */
@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        generateId: true,
        idGenerator: (req: IncomingMessage) =>
          resolveCorrelationId(req.headers[CORRELATION_ID_HEADER.toLowerCase()]),
        setup: (cls: ClsService, _req: IncomingMessage, res: ServerResponse) => {
          res.setHeader(CORRELATION_ID_HEADER, cls.getId());
        },
      },
    }),
  ],
})
export class CorrelationModule {}
