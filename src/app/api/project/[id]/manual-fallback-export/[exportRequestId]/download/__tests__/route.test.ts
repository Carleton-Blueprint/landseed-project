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
    project: {
      findUnique: jest.fn(),
    },
    manualFallbackExport: {
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
  logAuditEventNonBlocking: jest.fn(),
}));

const { GET } = require("../route") as {
  GET: (
    request: Request,
    context: { params: Promise<{ id: string; exportRequestId: string }> }
  ) => Promise<{ status: number; headers: { get: (name: string) => string | null } }>;
};

const { auth } = require("@/auth") as { auth: jest.Mock };
const { prisma } = require("lib/prisma") as {
  prisma: {
    manualFallbackExport: {
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

describe("GET /api/project/[id]/manual-fallback-export/[exportRequestId]/download", () => {
  const mockedAuth = auth as jest.Mock<() => Promise<unknown>>;
  const mockedFindUnique = prisma.manualFallbackExport.findUnique as jest.Mock;
  const mockedHasProjectAccess = hasProjectAccess as jest.Mock;
  const mockedGetSignedDownloadUrl = getSignedDownloadUrl as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.MANUAL_FALLBACK_EXPORT_DOWNLOAD_URL_EXPIRY_SECONDS;
  });

  it("returns 401 for unauthenticated users", async () => {
    mockedAuth.mockResolvedValue(null);

    const response = await GET({} as Request, {
      params: Promise.resolve({ id: "project-1", exportRequestId: "export-1" }),
    });

    expect(response.status).toBe(401);
    expect(mockedFindUnique).not.toHaveBeenCalled();
  });

  it("returns 409 when the export is not ready", async () => {
    mockedAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockedFindUnique.mockResolvedValue({
      id: "export-1",
      projectId: "project-1",
      status: "PENDING",
      s3Key: null,
      fileName: null,
      expiresAt: null,
    });
    mockedHasProjectAccess.mockResolvedValue(true);

    const response = await GET({} as Request, {
      params: Promise.resolve({ id: "project-1", exportRequestId: "export-1" }),
    });

    expect(response.status).toBe(409);
    expect(mockedGetSignedDownloadUrl).not.toHaveBeenCalled();
  });

  it("redirects to a signed url for ready exports", async () => {
    mockedAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockedFindUnique.mockResolvedValue({
      id: "export-1",
      projectId: "project-1",
      status: "READY",
      s3Key: "manual-fallback-exports/project-1/export-1.zip",
      fileName: "project-project-1-fallback-export-export-1.zip",
      expiresAt: null,
    });
    mockedHasProjectAccess.mockResolvedValue(true);
    mockedGetSignedDownloadUrl.mockResolvedValue("https://signed.example.com/export.zip");

    process.env.MANUAL_FALLBACK_EXPORT_DOWNLOAD_URL_EXPIRY_SECONDS = "900";

    const response = await GET({} as Request, {
      params: Promise.resolve({ id: "project-1", exportRequestId: "export-1" }),
    });

    expect(mockedGetSignedDownloadUrl).toHaveBeenCalledWith(
      "manual-fallback-exports/project-1/export-1.zip",
      900
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://signed.example.com/export.zip");
  });
});