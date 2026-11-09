import { runCli } from './migrate.js';

// Entry point of the `migrator` image: apply the migrations and exit. No server, no port.
process.exitCode = await runCli(process.env, {
  log: (line) => console.log(line),
  error: (line) => console.error(line),
});
