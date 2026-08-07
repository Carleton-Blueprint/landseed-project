/**
 * @jest-environment node
 */
import { describe, expect, it, jest, beforeEach, afterEach } from "@jest/globals";
import { createVerify, generateKeyPairSync } from "node:crypto";

/* eslint-disable @typescript-eslint/no-require-imports */

jest.mock("lib/prisma", () => ({
  prisma: {
    auditEvent: {
      findFirst: jest.fn(),
    },
    $executeRaw: jest.fn(),
  },
}));

const { prisma } = require("lib/prisma") as {
  prisma: {
    auditEvent: { findFirst: jest.Mock };
    $executeRaw: jest.Mock;
  };
};

const { logAuditEvent, logAuditEventNonBlocking } = require("../log") as typeof import("../log");

// Field order matches the VALUES(...) list in log.ts's Prisma.sql INSERT statement.
const FIELD_INDEX = {
  id: 0,
  category: 1,
  action: 2,
  outcome: 3,
  sensitivityLevel: 4,
  actorUserId: 5,
  projectId: 6,
  quoteId: 7,
  resourceType: 8,
  resourceId: 9,
  reason: 10,
  description: 11,
  beforeState: 12,
  afterState: 13,
  metadata: 14,
  ipAddress: 15,
  userAgent: 16,
  eventHash: 17,
  prevHash: 18,
  signature: 19,
  signedAt: 20,
  signedBy: 21,
  createdAt: 22,
} as const;

function baseInput() {
  return {
    category: "MANUAL_CHANGE" as const,
    action: "SOME_ACTION",
    outcome: "SUCCESS" as const,
    resourceType: "Quote",
    resourceId: "quote-1",
    projectId: "project-1",
  };
}

describe("logAuditEvent", () => {
  const originalPrivateKey = process.env.AUDIT_SIGNING_PRIVATE_KEY;
  const originalKeyId = process.env.AUDIT_SIGNING_KEY_ID;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.AUDIT_SIGNING_PRIVATE_KEY;
    delete process.env.AUDIT_SIGNING_KEY_ID;
  });

  afterEach(() => {
    if (originalPrivateKey === undefined) delete process.env.AUDIT_SIGNING_PRIVATE_KEY;
    else process.env.AUDIT_SIGNING_PRIVATE_KEY = originalPrivateKey;
    if (originalKeyId === undefined) delete process.env.AUDIT_SIGNING_KEY_ID;
    else process.env.AUDIT_SIGNING_KEY_ID = originalKeyId;
  });

  it("sets prevHash to null for the first event in the chain (no prior audit events)", async () => {
    prisma.auditEvent.findFirst.mockResolvedValue(null);
    prisma.$executeRaw.mockResolvedValue(undefined);

    await logAuditEvent(baseInput());

    expect(prisma.auditEvent.findFirst).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
      select: { eventHash: true },
    });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    const sqlArg = prisma.$executeRaw.mock.calls[0][0] as { values: unknown[] };
    expect(sqlArg.values[FIELD_INDEX.prevHash]).toBeNull();
    expect(sqlArg.values[FIELD_INDEX.eventHash]).toEqual(expect.any(String));
    expect((sqlArg.values[FIELD_INDEX.eventHash] as string).length).toBe(64); // sha256 hex digest
  });

  it("chains prevHash off the previous event's eventHash", async () => {
    prisma.auditEvent.findFirst.mockResolvedValue({ eventHash: "prior-hash-abc123" });
    prisma.$executeRaw.mockResolvedValue(undefined);

    await logAuditEvent(baseInput());

    const sqlArg = prisma.$executeRaw.mock.calls[0][0] as { values: unknown[] };
    expect(sqlArg.values[FIELD_INDEX.prevHash]).toBe("prior-hash-abc123");
  });

  it("writes the resource/category/outcome fields and defaults sensitivityLevel to CONFIDENTIAL", async () => {
    prisma.auditEvent.findFirst.mockResolvedValue(null);
    prisma.$executeRaw.mockResolvedValue(undefined);

    await logAuditEvent({
      ...baseInput(),
      actorUserId: "user-1",
      quoteId: "quote-9",
      reason: "because",
      description: "a description",
      ipAddress: "203.0.113.5",
      userAgent: "jest-agent",
    });

    const sqlArg = prisma.$executeRaw.mock.calls[0][0] as { values: unknown[] };
    expect(sqlArg.values[FIELD_INDEX.category]).toBe("MANUAL_CHANGE");
    expect(sqlArg.values[FIELD_INDEX.action]).toBe("SOME_ACTION");
    expect(sqlArg.values[FIELD_INDEX.outcome]).toBe("SUCCESS");
    expect(sqlArg.values[FIELD_INDEX.sensitivityLevel]).toBe("CONFIDENTIAL");
    expect(sqlArg.values[FIELD_INDEX.actorUserId]).toBe("user-1");
    expect(sqlArg.values[FIELD_INDEX.projectId]).toBe("project-1");
    expect(sqlArg.values[FIELD_INDEX.quoteId]).toBe("quote-9");
    expect(sqlArg.values[FIELD_INDEX.resourceType]).toBe("Quote");
    expect(sqlArg.values[FIELD_INDEX.resourceId]).toBe("quote-1");
    expect(sqlArg.values[FIELD_INDEX.reason]).toBe("because");
    expect(sqlArg.values[FIELD_INDEX.description]).toBe("a description");
    expect(sqlArg.values[FIELD_INDEX.ipAddress]).toBe("203.0.113.5");
    expect(sqlArg.values[FIELD_INDEX.userAgent]).toBe("jest-agent");
  });

  it("serializes beforeState/afterState/metadata to JSON text, and null when undefined", async () => {
    prisma.auditEvent.findFirst.mockResolvedValue(null);
    prisma.$executeRaw.mockResolvedValue(undefined);

    await logAuditEvent({
      ...baseInput(),
      beforeState: { foo: "bar" },
      afterState: undefined,
      metadata: { count: 3 },
    });

    const sqlArg = prisma.$executeRaw.mock.calls[0][0] as { values: unknown[] };
    expect(sqlArg.values[FIELD_INDEX.beforeState]).toBe(JSON.stringify({ foo: "bar" }));
    expect(sqlArg.values[FIELD_INDEX.afterState]).toBeNull();
    expect(sqlArg.values[FIELD_INDEX.metadata]).toBe(JSON.stringify({ count: 3 }));
  });

  // NOTE: toJsonText() is designed to gracefully fall back to a serializationError
  // marker when JSON.stringify() throws (e.g. on circular references). However,
  // payloadForHash (used for the eventHash computation) embeds the *raw* input.metadata
  // object directly rather than the toJsonText()-sanitized value, so JSON.stringify()
  // on payloadForHash throws uncaught for circular metadata before toJsonText's
  // fallback ever has a chance to help. See src/backend/audit/log.ts:54-69 — this looks
  // like a real bug (reported, not fixed, per task instructions).
  it("throws when metadata is circular, because payloadForHash hashes raw metadata rather than the toJsonText-safe value", async () => {
    prisma.auditEvent.findFirst.mockResolvedValue(null);
    prisma.$executeRaw.mockResolvedValue(undefined);

    const circular: Record<string, unknown> = {};
    circular.self = circular;

    await expect(
      logAuditEvent({
        ...baseInput(),
        metadata: circular,
      })
    ).rejects.toThrow(/circular structure/i);

    // The write never happens because the hash computation throws first.
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it("logAuditEventNonBlocking still swallows the circular-metadata failure without throwing", async () => {
    prisma.auditEvent.findFirst.mockResolvedValue(null);
    prisma.$executeRaw.mockResolvedValue(undefined);

    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const circular: Record<string, unknown> = {};
    circular.self = circular;

    await expect(
      logAuditEventNonBlocking({
        ...baseInput(),
        metadata: circular,
      })
    ).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalledWith("Audit logging failed:", expect.any(Error));

    consoleErrorSpy.mockRestore();
  });

  it("does not sign when AUDIT_SIGNING_PRIVATE_KEY is unset", async () => {
    prisma.auditEvent.findFirst.mockResolvedValue(null);
    prisma.$executeRaw.mockResolvedValue(undefined);

    await logAuditEvent(baseInput());

    const sqlArg = prisma.$executeRaw.mock.calls[0][0] as { values: unknown[] };
    expect(sqlArg.values[FIELD_INDEX.signature]).toBeNull();
    expect(sqlArg.values[FIELD_INDEX.signedAt]).toBeNull();
    expect(sqlArg.values[FIELD_INDEX.signedBy]).toBeNull();
  });

  it("signs the event hash with a real RSA key when AUDIT_SIGNING_PRIVATE_KEY is set, producing a verifiable signature", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

    process.env.AUDIT_SIGNING_PRIVATE_KEY = privateKeyPem;
    process.env.AUDIT_SIGNING_KEY_ID = "key-2026";

    prisma.auditEvent.findFirst.mockResolvedValue(null);
    prisma.$executeRaw.mockResolvedValue(undefined);

    await logAuditEvent(baseInput());

    const sqlArg = prisma.$executeRaw.mock.calls[0][0] as { values: unknown[] };
    const eventHash = sqlArg.values[FIELD_INDEX.eventHash] as string;
    const signature = sqlArg.values[FIELD_INDEX.signature] as string;

    expect(signature).toEqual(expect.any(String));
    expect(sqlArg.values[FIELD_INDEX.signedAt]).toBeInstanceOf(Date);
    expect(sqlArg.values[FIELD_INDEX.signedBy]).toBe("key-2026");

    const verify = createVerify("RSA-SHA256");
    verify.update(eventHash);
    verify.end();
    expect(verify.verify(publicKeyPem, signature, "base64")).toBe(true);
  });

  it("defaults signedBy to 'local' when AUDIT_SIGNING_KEY_ID is not set", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

    process.env.AUDIT_SIGNING_PRIVATE_KEY = privateKeyPem;

    prisma.auditEvent.findFirst.mockResolvedValue(null);
    prisma.$executeRaw.mockResolvedValue(undefined);

    await logAuditEvent(baseInput());

    const sqlArg = prisma.$executeRaw.mock.calls[0][0] as { values: unknown[] };
    expect(sqlArg.values[FIELD_INDEX.signedBy]).toBe("local");
  });

  it("catches a signing failure (invalid private key) and leaves signature/signedAt/signedBy null", async () => {
    process.env.AUDIT_SIGNING_PRIVATE_KEY = "not-a-valid-pem-private-key";

    prisma.auditEvent.findFirst.mockResolvedValue(null);
    prisma.$executeRaw.mockResolvedValue(undefined);

    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(logAuditEvent(baseInput())).resolves.toBeUndefined();

    const sqlArg = prisma.$executeRaw.mock.calls[0][0] as { values: unknown[] };
    expect(sqlArg.values[FIELD_INDEX.signature]).toBeNull();
    expect(sqlArg.values[FIELD_INDEX.signedAt]).toBeNull();
    expect(sqlArg.values[FIELD_INDEX.signedBy]).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalledWith("Audit signing failed:", expect.anything());

    consoleErrorSpy.mockRestore();
  });

  it("propagates an error thrown by the underlying prisma insert (logAuditEvent itself does not swallow errors)", async () => {
    prisma.auditEvent.findFirst.mockResolvedValue(null);
    prisma.$executeRaw.mockRejectedValue(new Error("db insert failed"));

    await expect(logAuditEvent(baseInput())).rejects.toThrow("db insert failed");
  });
});

describe("logAuditEventNonBlocking", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.AUDIT_SIGNING_PRIVATE_KEY;
  });

  it("swallows an error thrown by the underlying insert and logs it via console.error, without propagating", async () => {
    prisma.auditEvent.findFirst.mockResolvedValue(null);
    prisma.$executeRaw.mockRejectedValue(new Error("db insert failed"));

    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(logAuditEventNonBlocking(baseInput())).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalledWith("Audit logging failed:", expect.any(Error));

    consoleErrorSpy.mockRestore();
  });

  it("swallows an error from a rejected findFirst lookup as well", async () => {
    prisma.auditEvent.findFirst.mockRejectedValue(new Error("db lookup failed"));

    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(logAuditEventNonBlocking(baseInput())).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalledWith("Audit logging failed:", expect.any(Error));
    expect(prisma.$executeRaw).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("succeeds silently (no console.error) on the happy path", async () => {
    prisma.auditEvent.findFirst.mockResolvedValue(null);
    prisma.$executeRaw.mockResolvedValue(undefined);

    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await logAuditEventNonBlocking(baseInput());

    expect(consoleErrorSpy).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
