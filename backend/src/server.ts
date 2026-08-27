import { createApp } from './app';
import { env } from './config/env';
import { disconnectPrisma } from './infrastructure/database/prisma';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`BizPilot AI backend listening on port ${String(env.PORT)} (${env.NODE_ENV}, AI_PROVIDER=${env.AI_PROVIDER})`);
});

function closeServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}, shutting down gracefully...`);
  await closeServer();
  await disconnectPrisma();
  process.exit(0);
}

function handleShutdownError(err: unknown): void {
  console.error('Error during shutdown:', err);
  process.exit(1);
}

process.on('SIGTERM', () => {
  shutdown('SIGTERM').catch(handleShutdownError);
});
process.on('SIGINT', () => {
  shutdown('SIGINT').catch(handleShutdownError);
});

// Phase 19 Section 11: the API must fail predictably rather than leave the
// process in an unknown state. Neither handler attempts to keep serving
// traffic after an unknown failure — logging full detail server-side (never
// to a client) and exiting lets the process manager (systemd/Docker/etc.)
// restart a clean instance, which is safer than limping on corrupted state.
process.on('uncaughtException', (err: Error) => {
  console.error('[fatal] uncaughtException:', err);
  shutdown('uncaughtException').catch(() => { process.exit(1); });
});
process.on('unhandledRejection', (reason: unknown) => {
  console.error('[fatal] unhandledRejection:', reason);
  shutdown('unhandledRejection').catch(() => { process.exit(1); });
});
