/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { prisma } from "lib/prisma";
import { auth } from "@/auth";
import { enqueueBuilderTrendTransfer } from "@/backend/integrations/buildertrend";
import type { RefinedEstimate } from "@/backend/services/refinedEstimate";
import type { TieredRefinedEstimate } from "@/backend/services/pricingTiers";

jest.mock("lib/prisma", () => ({
  prisma: {
    quote: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock("@/auth", () => ({
  auth: jest.fn(),
}));

jest.mock("@/backend/audit/log", () => ({
  logAuditEventNonBlocking: jest.fn(),
}));

jest.mock("@/backend/audit/requestContext", () => ({
  getRequestAuditContext: jest.fn(() => ({ ipAddress: "127.0.0.1", userAgent: "jest" })),
}));

jest.mock("@/backend/integrations/buildertrend", () => ({
  enqueueBuilderTrendTransfer: jest.fn(),
}));

import { POST } from "../route";

const mockedPrisma = prisma as unknown as {
  quote: { findUnique: jest.Mock };
  $transaction: jest.Mock;
};
const mockedAuth = auth as jest.MockedFunction<typeof auth>;
const mockedEnqueue = enqueueBuilderTrendTransfer as jest.MockedFunction<typeof enqueueBuilderTrendTransfer>;

const originalEnv = process.env.NODE_ENV;

function buildEstimate(total: number): RefinedEstimate {
  return {
    lineItems: [
      {
        description: "Walk-in shower",
        quantity: 1,
        pricingQuery: "Walk-in shower",
        pricingSource: "Home Depot",
        pricingLink: null,
        materialUnitCost: total * 0.5,
        materialTotal: total * 0.5,
        laborHours: 4,
        laborRate: total * 0.1,
        laborTotal: total * 0.2,
        markupPercentage: 0.15,
        markupTotal: total * 0.15,
        lineTotal: total,
      },
    ],
    subtotal: total * 0.7,
    laborTotal: total * 0.2,
    markupTotal: total * 0.15,
    total,
    estimateMin: total * 0.95,
    estimateMax: total * 1.05,
  };
}

function buildTieredEstimate(): TieredRefinedEstimate {
  return {
    tiers: {
      economy: buildEstimate(1000),
      standard: buildEstimate(1300),
      premium: buildEstimate(1700),
    },
  };
}

function buildQuoteRecord(refinedEstimate: unknown) {
  return {
    id: "quote-1",
    projectId: "proj-1",
    status: "PENDING",
    refinedEstimate,
    project: {
      address: "123 Main St",
      status: "estimate_ready",
      draftData: null,
      projectAccess: [{ userId: "user-1" }],
    },
  };
}

function makeTxMock(queryRawResults: unknown[][]) {
  let call = 0;
  return {
    $queryRaw: jest.fn((..._args: unknown[]) => Promise.resolve(queryRawResults[call++] ?? [])),
    project: { update: jest.fn().mockResolvedValue({}) },
    declineSurveyResponse: { upsert: jest.fn().mockResolvedValue({}) },
    quote: { update: jest.fn().mockResolvedValue({}) },
  };
}

function buildRequest(body: unknown) {
  return new NextRequest("http://localhost/api/quote/quote-1/respond", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/quote/[id]/respond", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = "production";
    mockedAuth.mockResolvedValue({ user: { id: "user-1" } } as never);
  });

  afterAll(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it("rejects accepting a tiered estimate without a selectedTier", async () => {
    mockedPrisma.quote.findUnique.mockResolvedValue(buildQuoteRecord(buildTieredEstimate()));

    const res = await POST(buildRequest({ status: "ACCEPTED" }), {
      params: Promise.resolve({ id: "quote-1" }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/selectedTier/i);
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects accepting a tiered estimate with an invalid selectedTier", async () => {
    mockedPrisma.quote.findUnique.mockResolvedValue(buildQuoteRecord(buildTieredEstimate()));

    const res = await POST(buildRequest({ status: "ACCEPTED", selectedTier: "deluxe" }), {
      params: Promise.resolve({ id: "quote-1" }),
    });

    expect(res.status).toBe(400);
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("persists the selected tier and includes accepted-tier itemization in the BuilderTrend payload", async () => {
    mockedPrisma.quote.findUnique.mockResolvedValue(buildQuoteRecord(buildTieredEstimate()));

    const txMock = makeTxMock([
      [{ id: "quote-1", status: "ACCEPTED", declinedReason: null }],
      [{ id: "transfer-1", status: "PENDING" }],
    ]);
    mockedPrisma.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback(txMock));

    const res = await POST(buildRequest({ status: "ACCEPTED", selectedTier: "premium" }), {
      params: Promise.resolve({ id: "quote-1" }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.quote.selectedTier).toBe("premium");

    expect(txMock.quote.update).toHaveBeenCalledWith({
      where: { id: "quote-1" },
      data: {
        refinedEstimate: expect.objectContaining({ selectedTier: "premium" }),
      },
    });

    const insertCall = txMock.$queryRaw.mock.calls[1][0] as { values: unknown[] };
    const payload = JSON.parse(insertCall.values[3] as string);
    expect(payload.estimate.selectedTier).toBe("premium");
    expect(payload.estimate.total).toBe(1700);
    expect(payload.estimate.lineItems).toHaveLength(1);

    expect(mockedEnqueue).toHaveBeenCalledWith("transfer-1");
  });

  it("accepts a single (non-tiered) estimate without requiring a selectedTier", async () => {
    mockedPrisma.quote.findUnique.mockResolvedValue(buildQuoteRecord(buildEstimate(500)));

    const txMock = makeTxMock([
      [{ id: "quote-1", status: "ACCEPTED", declinedReason: null }],
      [{ id: "transfer-1", status: "PENDING" }],
    ]);
    mockedPrisma.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback(txMock));

    const res = await POST(buildRequest({ status: "ACCEPTED" }), {
      params: Promise.resolve({ id: "quote-1" }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.quote.selectedTier).toBeNull();
    expect(txMock.quote.update).not.toHaveBeenCalled();

    const insertCall = txMock.$queryRaw.mock.calls[1][0] as { values: unknown[] };
    const payload = JSON.parse(insertCall.values[3] as string);
    expect(payload.estimate.selectedTier).toBeUndefined();
    expect(payload.estimate.lineItems).toBeUndefined();
  });
});
