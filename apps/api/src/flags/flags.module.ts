import { randomUUID } from 'node:crypto';
import { DynamicModule, Global, Logger, Module } from '@nestjs/common';
import { OpenFeature } from '@openfeature/server-sdk';
import { InMemoryProvider, OpenFeatureModule } from '@openfeature/nestjs-sdk';
import { FeatureFlagsSchema } from '../config/env.schema';
import { FeaturesController } from './features.controller';
import { FLAGS_CLIENT, FlagsService } from './flags.service';

type FlagValues = Record<string, boolean>;

/** Invalid configuration yields no flags, so every flag evaluates to its safe default (false). */
export function parseFeatureFlags(raw: string): { flags: FlagValues; valid: boolean } {
  try {
    const parsed = FeatureFlagsSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return { flags: parsed.data, valid: true };
  } catch {
    // Not JSON: handled like any other invalid configuration.
  }
  return { flags: {}, valid: false };
}

function toProviderConfiguration(flags: FlagValues) {
  return Object.fromEntries(
    Object.entries(flags).map(([key, value]) => [
      key,
      {
        disabled: false,
        variants: { on: true, off: false },
        defaultVariant: value ? 'on' : 'off',
      },
    ]),
  );
}

@Global()
@Module({})
export class FlagsModule {
  static forRoot(rawFlags: string): DynamicModule {
    const { flags, valid } = parseFeatureFlags(rawFlags);
    if (!valid) {
      // Names nothing from the value: it may be a malformed fragment of the configuration.
      new Logger(FlagsModule.name).warn('FEATURE_FLAGS is invalid: all flags evaluate to false');
    }
    // One domain per module instance keeps the global OpenFeature registry from being shared.
    const domain = `api-${randomUUID()}`;
    const provider = new InMemoryProvider(toProviderConfiguration(flags));

    return {
      module: FlagsModule,
      imports: [OpenFeatureModule.forRoot({ providers: { [domain]: provider } })],
      controllers: [FeaturesController],
      providers: [
        { provide: FLAGS_CLIENT, useFactory: () => OpenFeature.getClient(domain) },
        FlagsService,
      ],
      exports: [FlagsService],
    };
  }
}
