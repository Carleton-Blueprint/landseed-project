/**
 * Split out from requireRole.ts so it has zero dependencies (no Prisma) and
 * can be imported by both Node-runtime code and middleware.ts's Edge
 * bundle. Importing anything from requireRole.ts itself would drag its
 * top-level `import { prisma } from "lib/prisma"` into that Edge bundle —
 * see requireCachedRole.ts for the Edge-safe role check.
 */
export class HttpError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.status = status;
  }
}
