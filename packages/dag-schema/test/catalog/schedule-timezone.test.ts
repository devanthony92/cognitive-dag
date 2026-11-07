import { describe, expect, it } from 'vitest';
import { NODE_CATALOG, validateDefinition } from '../../src/index.js';
import { def, node } from '../helpers.js';

const schema = NODE_CATALOG['trigger.schedule'].configSchema;

const publish = (config: Record<string, unknown>) =>
  validateDefinition(def([node('start', 'trigger.schedule', config)]));

describe('trigger.schedule timezone (F7, research R6)', () => {
  it.each([
    'UTC',
    'America/Bogota',
    'Europe/Madrid',
    'Asia/Tokyo',
    'America/Argentina/Buenos_Aires',
  ])('accepts the IANA zone %s', (timezone) => {
    expect(schema.safeParse({ cron: '0 9 * * *', timezone }).success).toBe(true);
    expect(publish({ cron: '0 9 * * *', timezone }).errors).toEqual([]);
  });

  it('defaults to UTC', () => {
    expect(schema.parse({ cron: '0 9 * * *' })).toEqual({ cron: '0 9 * * *', timezone: 'UTC' });
  });

  it.each(['Mars/Olympus', 'Nowhere/City', 'America/Atlantis', 'america/bogota', 'EST5EDTX'])(
    'rejects %s: well formed but not an IANA zone',
    (timezone) => {
      expect(schema.safeParse({ cron: '0 9 * * *', timezone }).success).toBe(false);
      const result = publish({ cron: '0 9 * * *', timezone });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toMatchObject({
        code: 'SCHEDULE_TIMEZONE_INVALID',
        location: { node: 'start', field: 'config.timezone' },
      });
      expect(result.errors[0]?.message).toContain('zona horaria');
    },
  );

  it.each(['!!', '', '../etc/passwd'])('rejects the malformed zone %j', (timezone) => {
    expect(schema.safeParse({ cron: '0 9 * * *', timezone }).success).toBe(false);
  });
});

describe('trigger.schedule cron (F7)', () => {
  it.each(['0 9 * * *', '*/5 * * * *', '0 0 1 1 *', '15 14 1 * 1-5', '0 9,17 * * mon-fri'])(
    'accepts %s',
    (cron) => {
      expect(schema.safeParse({ cron, timezone: 'UTC' }).success).toBe(true);
    },
  );

  it.each(['* * * *', '* * * * * *', 'every day', '', '0 9 * *  *x y'])(
    'rejects %j: it needs exactly 5 fields',
    (cron) => {
      expect(schema.safeParse({ cron, timezone: 'UTC' }).success).toBe(false);
    },
  );
});
