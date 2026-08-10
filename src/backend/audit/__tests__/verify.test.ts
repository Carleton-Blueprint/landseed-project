import { describe, expect, it, jest, beforeEach, afterEach } from "@jest/globals";
import { createHash, createSign, generateKeyPairSync } from "node:crypto";

/* eslint-disable @typescript-eslint/no-require-imports */

jest.mock("lib/prisma", () => ({
  prisma: {
    auditEvent: {
      findMany: jest.fn(),
    },
  },
}));

const { prisma } = require("lib/prisma") as {
  prisma: { auditEvent: { findMany: jest.Mock } };
};

const { verifyAuditChain } = require("../verify") as typeof import("../verify");

type AuditEventRow = {
  id: string;
  category: string;
  action: string;
  outcome: string;
  resourceType: string;
  resourceId: string | null;
  projectId: string | null;
  actorUserId: string | null;
  createdAt: Date;
  beforeState: unknown;
  afterState: unknown;
  metadata: unknown;
  eventHash: string;
  prevHash: string | null;
  signature: string | null;
};

function computeHash(ev: Omit<AuditEventRow, "eventHash" | "prevHash" | "signature">): string {
  const payloadForHash = {
    id: ev.id,
    category: ev.category,
    action: ev.action,
    outcome: ev.outcome,
    resourceType: ev.resourceType,
    resourceId: ev.resourceId ?? null,
    projectId: ev.projectId ?? null,
    actorUserId: ev.actorUserId ?? null,
    createdAt: ev.createdAt?.toISOString(),
    beforeState: ev.beforeState ?? null,
    afterState: ev.afterState ?? null,
    metadata: ev.metadata ?? null,
  };
  return createHash("sha256").update(JSON.stringify(payloadForHash)).digest("hex");
}

function makeEvent(
  overrides: Partial<AuditEventRow> & { prevHash?: string | null }
): AuditEventRow {
  const base: Omit<AuditEventRow, "eventHash" | "prevHash" | "signature"> = {
    id: overrides.id ?? "event-1",
    category: overrides.category ?? "MANUAL_CHANGE",
    action: overrides.action ?? "SOME_ACTION",
    outcome: overrides.outcome ?? "SUCCESS",
    resourceType: overrides.resourceType ?? "Quote",
    resourceId: overrides.resourceId ?? "quote-1",
    projectId: overrides.projectId ?? "project-1",
    actorUserId: overrides.actorUserId ?? "user-1",
    createdAt: overrides.createdAt ?? new Date("2026-01-01T00:00:00.000Z"),
    beforeState: overrides.beforeState ?? null,
    afterState: overrides.afterState ?? null,
    metadata: overrides.metadata ?? null,
  };
  const eventHash =
    "eventHash" in overrides && overrides.eventHash !== undefined
      ? overrides.eventHash
      : computeHash(base);

  return {
    ...base,
    eventHash: eventHash as string,
    prevHash: overrides.prevHash ?? null,
    signature: overrides.signature ?? null,
  };
}

describe("verifyAuditChain", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.AUDIT_SIGNING_PUBLIC_KEY;
  });

  afterEach(() => {
    delete process.env.AUDIT_SIGNING_PUBLIC_KEY;
  });

  it("returns total 0 and no mismatches for an empty chain", async () => {
    prisma.auditEvent.findMany.mockResolvedValue([]);

    const result = await verifyAuditChain();

    expect(result.total).toBe(0);
    expect(result.mismatches).toEqual([]);
  });

  it("passes `limit` through to findMany's `take`", async () => {
    prisma.auditEvent.findMany.mockResolvedValue([]);

    await verifyAuditChain(5);

    expect(prisma.auditEvent.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "asc" },
      take: 5,
    });
  });

  it("passes `undefined` as `take` when no limit is given", async () => {
    prisma.auditEvent.findMany.mockResolvedValue([]);

    await verifyAuditChain();

    expect(prisma.auditEvent.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "asc" },
      take: undefined,
    });
  });

  it("reports no mismatches for a fully valid two-event chain", async () => {
    const first = makeEvent({ id: "event-1", prevHash: null });
    const second = makeEvent({
      id: "event-2",
      prevHash: first.eventHash,
      createdAt: new Date("2026-01-01T00:05:00.000Z"),
    });

    prisma.auditEvent.findMany.mockResolvedValue([first, second]);

    const result = await verifyAuditChain();

    expect(result.total).toBe(2);
    expect(result.mismatches).toEqual([]);
  });

  it("flags a hash_mismatch when eventHash does not match recomputed hash", async () => {
    const tampered = makeEvent({ id: "event-1", eventHash: "deadbeef" });

    prisma.auditEvent.findMany.mockResolvedValue([tampered]);

    const result = await verifyAuditChain();

    expect(result.total).toBe(1);
    expect(result.mismatches).toEqual([
      { id: "event-1", index: 0, ok: false, reason: "hash_mismatch" },
    ]);
  });

  it("flags a prevhash_mismatch when prevHash doesn't match the prior event's eventHash", async () => {
    const first = makeEvent({ id: "event-1", prevHash: null });
    const second = makeEvent({
      id: "event-2",
      prevHash: "not-the-real-prev-hash",
      createdAt: new Date("2026-01-01T00:05:00.000Z"),
    });

    prisma.auditEvent.findMany.mockResolvedValue([first, second]);

    const result = await verifyAuditChain();

    expect(result.total).toBe(2);
    expect(result.mismatches).toEqual([
      { id: "event-2", index: 1, ok: false, reason: "prevhash_mismatch" },
    ]);
  });

  it("does not check prevHash for the first event in the chain (i=0)", async () => {
    // First event has a bogus prevHash, but since i === 0 it should never be checked.
    const first = makeEvent({ id: "event-1", prevHash: "garbage-should-be-ignored" });

    prisma.auditEvent.findMany.mockResolvedValue([first]);

    const result = await verifyAuditChain();

    expect(result.mismatches).toEqual([]);
  });

  it("verifies a real RSA signature successfully when a valid public key is configured", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

    const event = makeEvent({ id: "event-1", prevHash: null });
    const signer = createSign("RSA-SHA256");
    signer.update(event.eventHash);
    signer.end();
    const signature = signer.sign(privateKeyPem, "base64");

    const signedEvent: AuditEventRow = { ...event, signature };

    process.env.AUDIT_SIGNING_PUBLIC_KEY = publicKeyPem;
    prisma.auditEvent.findMany.mockResolvedValue([signedEvent]);

    const result = await verifyAuditChain();

    expect(result.mismatches).toEqual([]);
  });

  it("flags missing_public_key when a signed event has no public key configured", async () => {
    const event = makeEvent({ id: "event-1", prevHash: null, signature: "some-signature==" });

    delete process.env.AUDIT_SIGNING_PUBLIC_KEY;
    prisma.auditEvent.findMany.mockResolvedValue([event]);

    const result = await verifyAuditChain();

    expect(result.mismatches).toEqual([
      { id: "event-1", index: 0, ok: false, reason: "missing_public_key" },
    ]);
  });

  it("flags invalid_signature when the signature does not verify against the public key", async () => {
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();

    const event = makeEvent({
      id: "event-1",
      prevHash: null,
      signature: Buffer.from("not-a-real-signature").toString("base64"),
    });

    process.env.AUDIT_SIGNING_PUBLIC_KEY = publicKeyPem;
    prisma.auditEvent.findMany.mockResolvedValue([event]);

    const result = await verifyAuditChain();

    expect(result.mismatches).toEqual([
      { id: "event-1", index: 0, ok: false, reason: "invalid_signature" },
    ]);
  });

  it("flags signature_verification_error when signature verification throws", async () => {
    const event = makeEvent({
      id: "event-1",
      prevHash: null,
      signature: "not-valid-base64-signature",
    });

    // An invalid PEM will cause createVerify/.verify to throw.
    process.env.AUDIT_SIGNING_PUBLIC_KEY = "not-a-valid-pem-key";
    prisma.auditEvent.findMany.mockResolvedValue([event]);

    const result = await verifyAuditChain();

    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0]).toMatchObject({
      id: "event-1",
      index: 0,
      ok: false,
      reason: "signature_verification_error",
    });
    expect(typeof result.mismatches[0].error).toBe("string");
  });
});
