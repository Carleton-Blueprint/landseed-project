/**
 * @jest-environment node
 */
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import { enqueueBuilderTrendTransfer } from "@/backend/integrations/buildertrend";
import { generateAndStoreGrantDocument } from "@/backend/services/grantDocument";
import { markEstimateReadyForReview } from "@/backend/services/estimateReadyTransition";
import { prisma } from "lib/prisma";

jest.mock("@/backend/audit/log", () => ({
  logAuditEventNonBlocking: jest.fn(),
}));

jest.mock("@/backend/integrations/buildertrend", () => ({
  enqueueBuilderTrendTransfer: jest.fn(),
}));

jest.mock("@/backend/services/grantDocument", () => ({
  generateAndStoreGrantDocument: jest.fn(),
}));

jest.mock("@/backend/services/estimateReadyTransition", () => ({
  markEstimateReadyForReview: jest.fn(),
}));

jest.mock("@/backend/queue", () => ({
  virusScanQueue: { add: jest.fn() },
}));

const mockedProjectFindUnique = jest.fn();
const mockedQuoteCreate = jest.fn();
const mockedBuilderTrendTransferCreate = jest.fn();
const mockedManualModeSubmissionUpdate = jest.fn();

jest.mock("lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: (...args: unknown[]) => mockedProjectFindUnique(...args),
    },
    quote: {
      create: (...args: unknown[]) => mockedQuoteCreate(...args),
    },
    builderTrendTransfer: {
      create: (...args: unknown[]) => mockedBuilderTrendTransferCreate(...args),
    },
    manualModeSubmission: {
      update: (...args: unknown[]) => mockedManualModeSubmissionUpdate(...args),
    },
  },
}));

const { generateManualOutputPackage } = require("../manualMode") as typeof import("../manualMode");

const mockedAudit = logAuditEventNonBlocking as jest.MockedFunction<typeof logAuditEventNonBlocking>;
const mockedEnqueueTransfer = enqueueBuilderTrendTransfer as jest.MockedFunction<typeof enqueueBuilderTrendTransfer>;
const mockedGenerateGrantDocument = generateAndStoreGrantDocument as jest.MockedFunction<
  typeof generateAndStoreGrantDocument
>;
const mockedMarkEstimateReady = markEstimateReadyForReview as jest.MockedFunction<typeof markEstimateReadyForReview>;

describe("generateManualOutputPackage", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockedProjectFindUnique.mockResolvedValue({
      id: "project-1",
      manualModeSubmission: {
        id: "submission-1",
        status: "READY",
        subtotal: 100,
        total: 100,
      },
    });
    mockedQuoteCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "quote-1",
      ...data,
    }));
    mockedBuilderTrendTransferCreate.mockResolvedValue({ id: "transfer-1" });
    mockedManualModeSubmissionUpdate.mockResolvedValue({});
    mockedMarkEstimateReady.mockResolvedValue({ notified: true } as never);
    mockedGenerateGrantDocument.mockResolvedValue({ grantDocumentKey: "grant-key-1" } as never);
  });

  it("creates the quote already ACCEPTED, recording staff acceptance instead of leaving it PENDING", async () => {
    await generateManualOutputPackage({ projectId: "project-1", actorUserId: "staff-1" });

    expect(mockedQuoteCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "ACCEPTED", source: "MANUAL" }),
      })
    );
  });

  it("still creates and enqueues the BuilderTrend work order, now against an accepted quote", async () => {
    const result = await generateManualOutputPackage({ projectId: "project-1", actorUserId: "staff-1" });

    expect(mockedBuilderTrendTransferCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ quoteId: "quote-1" }) })
    );
    expect(mockedEnqueueTransfer).toHaveBeenCalledWith("transfer-1");
    expect(result.builderTrendTransferId).toBe("transfer-1");
  });

  it("marks the audit trail with acceptanceRecordedBy: STAFF", async () => {
    await generateManualOutputPackage({ projectId: "project-1", actorUserId: "staff-1" });

    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "MANUAL_MODE_OUTPUT_PACKAGE_GENERATED",
        afterState: expect.objectContaining({ acceptanceRecordedBy: "STAFF" }),
      })
    );
  });
});
