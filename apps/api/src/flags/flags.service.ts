import { Inject, Injectable } from '@nestjs/common';
import type { Client } from '@openfeature/server-sdk';
import type { PublicFeatures } from '@cognitive-dag/contracts';
import { FLAG_CATALOG, type FlagDefinition } from './flags.catalog';

export const FLAGS_CLIENT = Symbol('FLAGS_CLIENT');

@Injectable()
export class FlagsService {
  constructor(@Inject(FLAGS_CLIENT) private readonly client: Client) {}

  /** Missing or unevaluable flags are off: the safe default for gated features. */
  isEnabled(flag: string): Promise<boolean> {
    return this.client.getBooleanValue(flag, false);
  }

  async publicFeatures(): Promise<PublicFeatures> {
    const catalog: Record<string, FlagDefinition> = FLAG_CATALOG;
    const keys = Object.keys(catalog).filter((key) => catalog[key]?.public === true);
    const values = await Promise.all(keys.map((key) => this.isEnabled(key)));
    return Object.fromEntries(keys.map((key, index) => [key, values[index] ?? false]));
  }
}
