import { Global, Module } from '@nestjs/common';
import { SecurityEventLogger } from './security-event.logger';

@Global()
@Module({ providers: [SecurityEventLogger], exports: [SecurityEventLogger] })
export class SecurityEventsModule {}
