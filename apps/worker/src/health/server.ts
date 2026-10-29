import { createServer, type Server } from 'node:http';
import type { HealthReport } from '@cognitive-dag/contracts';

/**
 * Minimal health endpoint for the operator (contracts/worker-health.md).
 * Bound to 127.0.0.1 only; readiness reflects the Temporal worker state.
 */
export function startHealthServer(port: number, isReady: () => boolean): Promise<Server> {
  const server = createServer((req, res) => {
    let status: number;
    let report: HealthReport | undefined;

    if (req.method === 'GET' && req.url === '/health/live') {
      status = 200;
      report = { status: 'ok' };
    } else if (req.method === 'GET' && req.url === '/health/ready') {
      const ready = isReady();
      status = ready ? 200 : 503;
      report = {
        status: ready ? 'ok' : 'error',
        checks: { 'temporal-worker': { status: ready ? 'up' : 'down' } },
      };
    } else {
      status = 404;
    }

    if (report) {
      res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(report));
    } else {
      res.writeHead(status).end();
    }
  });

  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}
