import { customType } from 'drizzle-orm/pg-core';

/** SHA-256 digests and other raw bytes; node-postgres maps bytea to Buffer. */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});
