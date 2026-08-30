/**
 * Shared graceful-shutdown registry for worker modules. Each worker module
 * (BullMQ-backed or interval/timeout-polling) calls registerShutdownHandler
 * instead of adding its own process.on("SIGTERM"/"SIGINT", ...) pair. This
 * keeps `worker:all` (allWorkers.ts, which imports every worker module into
 * one process) down to a single SIGTERM/SIGINT listener instead of one pair
 * per module, and ensures every worker's cleanup finishes before the
 * process exits instead of racing each other's process.exit(0).
 */
type ShutdownHandler = () => Promise<void> | void;

const handlers = new Map<string, ShutdownHandler>();
let installed = false;
let shuttingDown = false;

function installSignalHandlersOnce(): void {
  if (installed) return;
  installed = true;

  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`\n⚠️  ${signal} received. Closing ${handlers.size} worker(s) gracefully...`);
    await Promise.allSettled(
      Array.from(handlers.entries()).map(async ([name, handler]) => {
        try {
          await handler();
        } catch (err) {
          console.error(`⚠️  Error shutting down "${name}":`, err);
        }
      })
    );
    console.log("✅ Worker(s) closed. Exiting.");
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

export function registerShutdownHandler(name: string, handler: ShutdownHandler): void {
  installSignalHandlersOnce();
  handlers.set(name, handler);
}
