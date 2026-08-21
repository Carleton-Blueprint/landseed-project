import { beforeEach, describe, expect, it, jest } from "@jest/globals";
/* eslint-disable @typescript-eslint/no-require-imports */

jest.mock("next/server", () => {
  class MockResponse {
    status: number;
    private readonly headerMap: Map<string, string>;
    headers: { get: (name: string) => string | null };

    constructor(status: number, headers: Record<string, string> = {}) {
      this.status = status;
      this.headerMap = new Map(
        Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
      );
      this.headers = {
        get: (name: string) => this.headerMap.get(name.toLowerCase()) ?? null,
      };
    }
  }

  return {
    NextResponse: {
      json: (_body: unknown, init?: { status?: number }) =>
        new MockResponse(init?.status ?? 200, { "content-type": "application/json" }),
      redirect: (url: string, status = 307) => new MockResponse(status, { location: url }),
    },
  };
});

jest.mock("@/auth", () => ({
  auth: jest.fn(),
}));

jest.mock("lib/prisma", () => ({
  prisma: {
    grantMatchSummaryDocument: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock("@/backend/auth/projectAccess", () => ({
  hasProjectAccess: jest.fn(),
}));

jest.mock("lib/s3", () => ({
  getSignedDownloadUrl: jest.fn(),
}));

jest.mock("@/backend/audit/requestContext", () => ({
  getRequestAuditContext: jest.fn(() => ({ ipAddress: null, userAgent: null })),
}));

const { GET } = require("../route") as {
  GET: (
    request: Request,
    context: { params: Promise<{ id: string; docId: string }> }
  ) => Promise<{ status: number; headers: { get: (name: string) => string | null } }>;
};

const { auth } = require("@/auth") as { auth: jest.Mock };
const { prisma } = require("lib/prisma") as {
  prisma: {
    grantMatchSummaryDocument: {
      findUnique: jest.Mock;
    };
  };
};
const { hasProjectAccess } = require("@/backend/auth/projectAccess") as {
  hasProjectAccess: jest.Mock;
};
const { getSignedDownloadUrl } = require("lib/s3") as {
  getSignedDownloadUrl: jest.Mock;
};

type DocumentRecord = {
  id: string;
  projectId: string;
  status: string;
  s3Key: string | null;
  fileName: string | null;
};

describe("GET /api/project/[id]/grant-match-summary/[docId]/download", () => {
  const mockedAuth = auth as jest.Mock<() => Promise<unknown>>;
  const mockedFindUnique = prisma.grantMatchSummaryDocument.findUnique as jest.Mock<
    (...args: unknown[]) => Promise<DocumentRecord | null>
  >;
  const mockedHasProjectAccess = hasProjectAccess as jest.Mock<(...args: unknown[]) => Promise<boolean>>;
  const mockedGetSignedDownloadUrl = getSignedDownloadUrl as jest.Mock<(...args: unknown[]) => Promise<string>>;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.GRANT_MATCH_SUMMARY_DOWNLOAD_URL_EXPIRY_SECONDS;
  });

  it("returns 401 for unauthenticated users", async () => {
    mockedAuth.mockResolvedValue(null);

    const response = await GET({} as Request, {
      params: Promise.resolve({ id: "project-1", docId: "doc-1" }),
    });

    expect(response.status).toBe(401);
    expect(mockedFindUnique).not.toHaveBeenCalled();
  });

  it("returns 404 when the document does not belong to the project", async () => {
    mockedAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockedFindUnique.mockResolvedValue({
      id: "doc-1",
      projectId: "other-project",
      status: "READY",
      s3Key: "key",
      fileName: "file.pdf",
    });

    const response = await GET({} as Request, {
      params: Promise.resolve({ id: "project-1", docId: "doc-1" }),
    });

    expect(response.status).toBe(404);
  });

  it("returns 403 when the user lacks project access", async () => {
    mockedAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockedFindUnique.mockResolvedValue({
      id: "doc-1",
      projectId: "project-1",
      status: "READY",
      s3Key: "key",
      fileName: "file.pdf",
    });
    mockedHasProjectAccess.mockResolvedValue(false);

    const response = await GET({} as Request, {
      params: Promise.resolve({ id: "project-1", docId: "doc-1" }),
    });

    expect(response.status).toBe(403);
  });

  it("returns 409 when the document is not ready", async () => {
    mockedAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockedFindUnique.mockResolvedValue({
      id: "doc-1",
      projectId: "project-1",
      status: "PENDING",
      s3Key: null,
      fileName: null,
    });
    mockedHasProjectAccess.mockResolvedValue(true);

    const response = await GET({} as Request, {
      params: Promise.resolve({ id: "project-1", docId: "doc-1" }),
    });

    expect(response.status).toBe(409);
    expect(mockedGetSignedDownloadUrl).not.toHaveBeenCalled();
  });

  it("redirects to a signed url for ready documents", async () => {
    mockedAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockedFindUnique.mockResolvedValue({
      id: "doc-1",
      projectId: "project-1",
      status: "READY",
      s3Key: "projects/project-1/grant-match-summary/grant-match-summary-v1.pdf",
      fileName: "grant-match-summary-v1.pdf",
    });
    mockedHasProjectAccess.mockResolvedValue(true);
    mockedGetSignedDownloadUrl.mockResolvedValue("https://signed.example.com/summary.pdf");

    process.env.GRANT_MATCH_SUMMARY_DOWNLOAD_URL_EXPIRY_SECONDS = "900";

    const response = await GET({} as Request, {
      params: Promise.resolve({ id: "project-1", docId: "doc-1" }),
    });

    expect(mockedGetSignedDownloadUrl).toHaveBeenCalledWith(
      "projects/project-1/grant-match-summary/grant-match-summary-v1.pdf",
      900
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://signed.example.com/summary.pdf");
  });
});
