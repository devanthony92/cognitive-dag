import { createApp } from './app.factory';
import { InvalidConfigError, parseEnv } from './config/env.schema';
import { loadLocalEnv } from './config/load-env';

async function bootstrap(): Promise<void> {
  loadLocalEnv();

  let config;
  try {
    config = parseEnv(process.env);
  } catch (error) {
    if (error instanceof InvalidConfigError) {
      // Fail closed: refuse to start and name the variables, never their values.
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const app = await createApp(config);
  await app.listen(config.API_PORT);
}

void bootstrap();
