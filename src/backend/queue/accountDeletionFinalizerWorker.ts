import { prisma } from "lib/prisma";
import { finalizeAccountDeletionRequest } from "@/backend/services/accountDeletionRetention";
import { AccountDeletionRequestStatus } from "@prisma/client";

const SCAN_INTERVAL_MS = Number(process.env.ACCOUNT_DELETION_FINALIZER_INTERVAL_MS ?? 15 * 60 * 1000);

let isRunning = false;
let scanTimer: NodeJS.Timeout | null = null;

async function runFinalizer() {
  if (isRunning) return;
  isRunning = true;

  try {
    const now = new Date();
    const candidates = await prisma.accountDeletionRequest.findMany({
      where: {
        status: AccountDeletionRequestStatus.READY_FOR_DELETION,
        deletedAt: null,
        gracePeriodEndsAt: { lte: now },
      },
      orderBy: { gracePeriodEndsAt: "asc" },
      take: 50,
    });

    for (const r of candidates) {
      try {
        await finalizeAccountDeletionRequest({ requestId: r.id });
      } catch (err) {
        console.error("Failed finalizing account deletion for request", r.id, err);
      }
    }
  } catch (err) {
    console.error("Account deletion finalizer run failed:", err);
  } finally {
    isRunning = false;
  }
}

console.log("Account deletion finalizer started", { scanIntervalMs: SCAN_INTERVAL_MS });

void runFinalizer();
scanTimer = setInterval(() => void runFinalizer(), SCAN_INTERVAL_MS);

process.on("SIGTERM", () => {
  if (scanTimer) clearInterval(scanTimer);
  process.exit(0);
});

process.on("SIGINT", () => {
  if (scanTimer) clearInterval(scanTimer);
  process.exit(0);
});
