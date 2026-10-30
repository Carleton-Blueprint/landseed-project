/**
 * @jest-environment node
 */
import { prisma } from "lib/prisma";
import { getOverrideAttribution, getOverrideAttributions } from "../overrideAttribution";
import { QUOTE_OVERRIDE_AUDIT_ACTION } from "../quoteOverride";

jest.mock("lib/prisma", () => ({
  prisma: {
    eligibilityAssessment: { findMany: jest.fn() },
    quote: { findMany: jest.fn() },
    auditEvent: { findMany: jest.fn() },
  },
}));

const mockedPrisma = prisma as unknown as {
  eligibilityAssessment: { findMany: jest.Mock };
  quote: { findMany: jest.Mock };
  auditEvent: { findMany: jest.Mock };
};

const dana = { name: "Dana Admin", email: "dana@example.com" };
const sam = { name: "Sam Staff", email: "sam@example.com" };
const anonymized = { name: null, email: null };

function assessment(overrides: Record<string, unknown>) {
  return {
    projectId: "proj-1",
    source: "ADMIN",
    adminAction: "REASSESS",
    createdAt: new Date("2026-10-30T12:00:00Z"),
    createdByUser: dana,
    ...overrides,
  };
}

function quote(overrides: Record<string, unknown>) {
  return {
    id: "quote-1",
    projectId: "proj-1",
    createdAt: new Date("2026-10-30T10:00:00Z"),
    override: null,
    ...overrides,
  };
}

describe("getOverrideAttributions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.eligibilityAssessment.findMany.mockResolvedValue([]);
    mockedPrisma.quote.findMany.mockResolvedValue([]);
    mockedPrisma.auditEvent.findMany.mockResolvedValue([]);
  });

  it("returns an empty map without querying for no project ids", async () => {
    const result = await getOverrideAttributions([]);

    expect(result.size).toBe(0);
    expect(mockedPrisma.eligibilityAssessment.findMany).not.toHaveBeenCalled();
  });

  it("returns no attribution for an automatic-only project with no override", async () => {
    mockedPrisma.eligibilityAssessment.findMany.mockResolvedValue([
      assessment({ source: "AUTOMATIC", adminAction: null, createdByUser: null }),
    ]);
    mockedPrisma.quote.findMany.mockResolvedValue([quote({})]);

    expect(await getOverrideAttribution("proj-1")).toEqual({
      assessment: null,
      postEstimateOverride: null,
      clientOverridden: false,
    });
    expect(mockedPrisma.auditEvent.findMany).not.toHaveBeenCalled();
  });

  it("returns no attribution for an unknown project", async () => {
    expect(await getOverrideAttribution("missing")).toEqual({
      assessment: null,
      postEstimateOverride: null,
      clientOverridden: false,
    });
  });

  it("attributes an ADMIN assessment to its creator", async () => {
    mockedPrisma.eligibilityAssessment.findMany.mockResolvedValue([
      assessment({ adminAction: "MANUAL_GRANTS" }),
    ]);

    const { assessment: result } = await getOverrideAttribution("proj-1");

    expect(result).toEqual({
      adminAction: "MANUAL_GRANTS",
      adminName: "Dana Admin",
      at: "2026-10-30T12:00:00.000Z",
      stage: "pre-estimate",
    });
  });

  describe("pre/post-estimate stage", () => {
    it("is pre-estimate when the project has no quote", async () => {
      mockedPrisma.eligibilityAssessment.findMany.mockResolvedValue([assessment({})]);

      expect((await getOverrideAttribution("proj-1")).assessment?.stage).toBe("pre-estimate");
    });

    it("is pre-estimate when the assessment predates the first quote", async () => {
      mockedPrisma.eligibilityAssessment.findMany.mockResolvedValue([
        assessment({ createdAt: new Date("2026-10-30T09:59:59Z") }),
      ]);
      mockedPrisma.quote.findMany.mockResolvedValue([quote({})]);

      expect((await getOverrideAttribution("proj-1")).assessment?.stage).toBe("pre-estimate");
    });

    it("is post-estimate from the first quote's createdAt onwards, even if later quotes exist", async () => {
      mockedPrisma.eligibilityAssessment.findMany.mockResolvedValue([
        assessment({ createdAt: new Date("2026-10-30T10:00:00Z") }),
      ]);
      mockedPrisma.quote.findMany.mockResolvedValue([
        quote({}),
        quote({ id: "quote-2", createdAt: new Date("2026-10-31T10:00:00Z") }),
      ]);

      expect((await getOverrideAttribution("proj-1")).assessment?.stage).toBe("post-estimate");
    });
  });

  it("falls back to 'a former staff member' for an anonymized admin", async () => {
    mockedPrisma.eligibilityAssessment.findMany.mockResolvedValue([assessment({ createdByUser: anonymized })]);

    expect((await getOverrideAttribution("proj-1")).assessment?.adminName).toBe("a former staff member");
  });

  it("falls back to 'a former staff member' when the creator is unknown (CLI script)", async () => {
    mockedPrisma.eligibilityAssessment.findMany.mockResolvedValue([assessment({ createdByUser: null })]);

    expect((await getOverrideAttribution("proj-1")).assessment?.adminName).toBe("a former staff member");
  });

  describe("post-estimate override", () => {
    const overriddenQuote = quote({
      override: { updatedAt: new Date("2026-10-31T08:00:00Z"), overriddenByUser: sam },
    });

    it("uses the latest override's admin and updatedAt, with edit count and history from the audit log", async () => {
      mockedPrisma.quote.findMany.mockResolvedValue([overriddenQuote]);
      mockedPrisma.auditEvent.findMany.mockResolvedValue([
        { quoteId: "quote-1", createdAt: new Date("2026-10-31T08:00:00Z"), actorUser: sam },
        { quoteId: "quote-1", createdAt: new Date("2026-10-30T16:00:00Z"), actorUser: anonymized },
      ]);

      const result = await getOverrideAttribution("proj-1");

      expect(mockedPrisma.auditEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { action: QUOTE_OVERRIDE_AUDIT_ACTION, outcome: "SUCCESS", quoteId: { in: ["quote-1"] } },
        })
      );
      expect(result.postEstimateOverride).toEqual({
        adminName: "Sam Staff",
        at: "2026-10-31T08:00:00.000Z",
        editCount: 2,
        history: [
          { adminName: "Sam Staff", at: "2026-10-31T08:00:00.000Z" },
          { adminName: "a former staff member", at: "2026-10-30T16:00:00.000Z" },
        ],
      });
      expect(result.clientOverridden).toBe(true);
    });

    it("counts one edit when the audit log has no entries for the override", async () => {
      mockedPrisma.quote.findMany.mockResolvedValue([overriddenQuote]);

      const result = await getOverrideAttribution("proj-1");

      expect(result.postEstimateOverride?.editCount).toBe(1);
      expect(result.postEstimateOverride?.history).toEqual([]);
    });

    it("only looks at the latest quote", async () => {
      mockedPrisma.quote.findMany.mockResolvedValue([
        overriddenQuote,
        quote({ id: "quote-2", createdAt: new Date("2026-11-01T10:00:00Z") }),
      ]);

      const result = await getOverrideAttribution("proj-1");

      expect(result.postEstimateOverride).toBeNull();
      expect(result.clientOverridden).toBe(false);
    });
  });

  it.each(["PRE_ESTIMATE_OVERRIDE", "MANUAL_GRANTS", "REASSESS"])(
    "does not mark the client view overridden for an ADMIN %s assessment alone",
    async (adminAction) => {
      mockedPrisma.eligibilityAssessment.findMany.mockResolvedValue([assessment({ adminAction })]);
      mockedPrisma.quote.findMany.mockResolvedValue([quote({})]);

      const result = await getOverrideAttribution("proj-1");

      expect(result.assessment?.adminAction).toBe(adminAction);
      expect(result.clientOverridden).toBe(false);
    }
  );

  it("batches several projects into one query per table", async () => {
    mockedPrisma.eligibilityAssessment.findMany.mockResolvedValue([
      assessment({ projectId: "proj-1" }),
      assessment({ projectId: "proj-2", source: "AUTOMATIC", adminAction: null, createdByUser: null }),
    ]);
    mockedPrisma.quote.findMany.mockResolvedValue([
      quote({ projectId: "proj-2", override: { updatedAt: new Date("2026-10-31T08:00:00Z"), overriddenByUser: sam } }),
    ]);

    const result = await getOverrideAttributions(["proj-1", "proj-2", "proj-3"]);

    expect(mockedPrisma.eligibilityAssessment.findMany).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.quote.findMany).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.auditEvent.findMany).toHaveBeenCalledTimes(1);
    expect(result.get("proj-1")?.assessment?.adminName).toBe("Dana Admin");
    expect(result.get("proj-2")?.assessment).toBeNull();
    expect(result.get("proj-2")?.clientOverridden).toBe(true);
    expect(result.get("proj-3")).toEqual({ assessment: null, postEstimateOverride: null, clientOverridden: false });
  });
});
