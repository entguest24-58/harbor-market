import { createApp } from './app';
import { config } from './config';
import { ensureSchema, pool } from './db';

async function main(): Promise<void> {
  await ensureSchema();
  const server = createApp().listen(config.port, () => {
    console.log(`Harbor Market API listening on port ${config.port}`);
  });

  const shutdown = (signal: string) => {
    console.log(`${signal} received, shutting down`);
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Failed to start', err);
  process.exit(1);
});
