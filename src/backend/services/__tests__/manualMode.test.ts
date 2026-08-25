/**
 * @jest-environment node
 */
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import { enqueueBuilderTrendTransfer } from "@/backend/integrations/buildertrend";
import { generateAndStoreGrantDocument } from "@/backend/services/grantDocument";
import { markEstimateReadyForReview } from "@/backend/services/estimateReadyTransition";
import { prisma } from "lib/prisma";
import { uploadToS3 } from "lib/s3";
import {
  generateManualOutputPackage,
  searchClientUsers,
  createManualModeProject,
  attachManualModePhoto,
  ManualModeError,
} from "../manualMode";

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

const mockedVirusScanQueueAdd = jest.fn();
jest.mock("@/backend/queue", () => ({
  virusScanQueue: { add: (...args: unknown[]) => mockedVirusScanQueueAdd(...args) },
}));

jest.mock("lib/s3", () => ({
  uploadToS3: jest.fn().mockResolvedValue("https://example.com/fake-photo.jpg"),
  S3_BUCKET: "test-bucket",
}));

const mockedProjectFindUnique = jest.fn();
const mockedProjectCreate = jest.fn();
const mockedQuoteCreate = jest.fn();
const mockedBuilderTrendTransferCreate = jest.fn();
const mockedManualModeSubmissionUpdate = jest.fn();
const mockedUserFindUnique = jest.fn();
const mockedUserFindMany = jest.fn();
const mockedPhotoCreate = jest.fn();

jest.mock("lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: (...args: unknown[]) => mockedProjectFindUnique(...args),
      create: (...args: unknown[]) => mockedProjectCreate(...args),
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
    user: {
      findUnique: (...args: unknown[]) => mockedUserFindUnique(...args),
      findMany: (...args: unknown[]) => mockedUserFindMany(...args),
    },
    photo: {
      create: (...args: unknown[]) => mockedPhotoCreate(...args),
    },
  },
}));

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
      address: "123 Main St",
      // Defaults to APPROVED so existing tests exercise output-package
      // generation without also having to think about the BuilderTrend
      // approval gate — see the dedicated "approval gate" tests below for that.
      status: "APPROVED",
      user: { name: "Jane Client", email: "jane@example.com", phone: "555-0100" },
      manualModeSubmission: {
        id: "submission-1",
        status: "READY",
        subtotal: 100,
        total: 100,
        modificationType: "Custom ramp install",
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

  it("populates the BuilderTrend transfer payload with summary-level fields from the manual submission", async () => {
    await generateManualOutputPackage({ projectId: "project-1", actorUserId: "staff-1" });

    expect(mockedBuilderTrendTransferCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payload: {
            schemaVersion: 2,
            project: { id: "project-1", address: "123 Main St" },
            client: { name: "Jane Client", email: "jane@example.com", phone: "555-0100" },
            modificationType: ["Custom ramp install"],
            totalEstimate: 100,
          },
        }),
      })
    );
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

  it("approval gate: creates the transfer but does not enqueue it when the project isn't APPROVED yet", async () => {
    mockedProjectFindUnique.mockResolvedValue({
      id: "project-1",
      address: "123 Main St",
      status: "ESTIMATE_ACCEPTED",
      user: { name: "Jane Client", email: "jane@example.com", phone: "555-0100" },
      manualModeSubmission: {
        id: "submission-1",
        status: "READY",
        subtotal: 100,
        total: 100,
        modificationType: "Custom ramp install",
      },
    });

    const result = await generateManualOutputPackage({ projectId: "project-1", actorUserId: "staff-1" });

    expect(mockedBuilderTrendTransferCreate).toHaveBeenCalled();
    expect(mockedEnqueueTransfer).not.toHaveBeenCalled();
    expect(result.builderTrendTransferId).toBe("transfer-1");
  });
});

describe("searchClientUsers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUserFindMany.mockResolvedValue([
      { id: "client-1", name: "Jane Client", email: "jane@example.com", phone: "555-0100" },
    ]);
  });

  it("returns an empty array without querying the database for a blank query", async () => {
    const result = await searchClientUsers("   ");
    expect(result).toEqual([]);
    expect(mockedUserFindMany).not.toHaveBeenCalled();
  });

  it("searches by name/email (case-insensitive) and caps results at 10", async () => {
    const result = await searchClientUsers("jane");

    expect(mockedUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { name: { contains: "jane", mode: "insensitive" } },
            { email: { contains: "jane", mode: "insensitive" } },
          ],
        },
        take: 10,
      })
    );
    expect(result).toEqual([{ id: "client-1", name: "Jane Client", email: "jane@example.com", phone: "555-0100" }]);
  });
});

describe("createManualModeProject", () => {
  const validAddress = {
    addressLine1: "123 Main St",
    addressLine2: "",
    city: "Ottawa",
    province: "ON",
    postalCode: "K1A 0B1",
    ownershipStatus: "owner" as const,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedUserFindUnique.mockResolvedValue({ id: "client-1" });
    mockedProjectCreate.mockResolvedValue({ id: "project-new-1" });
  });

  it("rejects when the selected client doesn't exist", async () => {
    mockedUserFindUnique.mockResolvedValue(null);

    await expect(
      createManualModeProject({ clientUserId: "missing", actorUserId: "staff-1", address: validAddress })
    ).rejects.toMatchObject({ code: "CLIENT_NOT_FOUND" } satisfies Partial<ManualModeError>);
    expect(mockedProjectCreate).not.toHaveBeenCalled();
  });

  it("rejects invalid address details", async () => {
    await expect(
      createManualModeProject({
        clientUserId: "client-1",
        actorUserId: "staff-1",
        address: { ...validAddress, addressLine1: "" },
      })
    ).rejects.toMatchObject({ code: "INVALID_ADDRESS" } satisfies Partial<ManualModeError>);
    expect(mockedProjectCreate).not.toHaveBeenCalled();
  });

  it("requires landlord details when ownershipStatus is tenant", async () => {
    await expect(
      createManualModeProject({
        clientUserId: "client-1",
        actorUserId: "staff-1",
        address: { ...validAddress, ownershipStatus: "tenant" },
      })
    ).rejects.toMatchObject({ code: "INVALID_ADDRESS" } satisfies Partial<ManualModeError>);
  });

  it("creates the project in DRAFT status with isManualMode true, owned by the selected client", async () => {
    const result = await createManualModeProject({
      clientUserId: "client-1",
      actorUserId: "staff-1",
      address: validAddress,
    });

    expect(mockedProjectCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "DRAFT",
          userId: "client-1",
          isManualMode: true,
          projectAccess: expect.objectContaining({
            create: expect.objectContaining({ userId: "client-1", role: "OWNER" }),
          }),
        }),
      })
    );
    expect(result.projectId).toBe("project-new-1");
  });
});

describe("attachManualModePhoto", () => {
  const validInput = {
    projectId: "project-1",
    actorUserId: "staff-1",
    fileName: "bathroom.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("fake"),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedProjectFindUnique.mockResolvedValue({ id: "project-1" });
    mockedPhotoCreate.mockResolvedValue({
      id: "photo-1",
      url: "https://example.com/fake-photo.jpg",
      virus_scan_status: "pending",
      createdAt: new Date(),
    });
  });

  it("rejects when the project doesn't exist", async () => {
    mockedProjectFindUnique.mockResolvedValue(null);

    await expect(attachManualModePhoto(validInput)).rejects.toMatchObject({
      code: "PROJECT_NOT_FOUND",
    } satisfies Partial<ManualModeError>);
    expect(mockedPhotoCreate).not.toHaveBeenCalled();
  });

  it("rejects disallowed file types", async () => {
    await expect(
      attachManualModePhoto({ ...validInput, mimeType: "application/pdf" })
    ).rejects.toMatchObject({ code: "INVALID_FILE_TYPE" } satisfies Partial<ManualModeError>);
    expect(mockedPhotoCreate).not.toHaveBeenCalled();
  });

  it("creates the photo with pending scan status and queues a virus scan job, never AI analysis", async () => {
    const result = await attachManualModePhoto(validInput);

    expect(uploadToS3).toHaveBeenCalled();
    expect(mockedPhotoCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ projectId: "project-1", virus_scan_status: "pending" }) })
    );
    expect(mockedVirusScanQueueAdd).toHaveBeenCalledWith(
      "scan-photo-1",
      expect.objectContaining({ photoId: "photo-1" }),
      expect.anything()
    );
    expect(result.id).toBe("photo-1");
  });
});
