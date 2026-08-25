/** @jest-environment node */

import { prisma } from "lib/prisma";
import { logAuditEvent } from "@/backend/audit/log";

describe("logAuditEvent", () => {
  const resourceId = `test-circular-${Date.now()}`;

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({ where: { resourceId } });
    await prisma.$disconnect();
  });

  it("does not throw on circular-reference metadata and still records a consistent hash", async () => {
    const circular: Record<string, unknown> = { note: "self-referencing" };
    circular.self = circular;

    await expect(
      logAuditEvent({
        category: "MANUAL_CHANGE",
        action: "TEST_CIRCULAR_METADATA",
        outcome: "SUCCESS",
        resourceType: "test",
        resourceId,
        metadata: circular,
      })
    ).resolves.toBeUndefined();

    const event = await prisma.auditEvent.findFirst({ where: { resourceId } });
    expect(event).not.toBeNull();
    expect(event?.eventHash).toEqual(expect.any(String));
    expect(event?.metadata).toEqual({ serializationError: true });
  });
});
