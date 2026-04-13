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
      redirect: (url: string, status = 307) =>
        new MockResponse(status, { location: url }),
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
  },
}));

jest.mock("@/backend/auth/projectAccess", () => ({
  hasProjectAccess: jest.fn(),
}));

jest.mock("lib/s3", () => ({
  getSignedDownloadUrl: jest.fn(),
}));

jest.mock("@/backend/audit/log", () => ({
  getRequestAuditContext: jest.fn(() => ({ ipAddress: null, userAgent: null })),
  logAuditEventNonBlocking: jest.fn(),
}));

const { GET } = require("../route") as {
  GET: (
    request: Request,
    context: { params: Promise<{ id: string }> }
  ) => Promise<{ status: number; headers: { get: (name: string) => string | null } }>;
};

const { auth } = require("@/auth") as {
  auth: jest.Mock;
};

const { prisma } = require("lib/prisma") as {
  prisma: {
    project: {
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

describe("GET /api/documents/[id]/download", () => {
  const mockedAuth = auth as jest.Mock<() => Promise<unknown>>;
  const mockedPrisma = prisma;
  const mockedFindUnique = mockedPrisma.project.findUnique as jest.Mock<
    (args: unknown) => Promise<unknown>
  >;
  const mockedHasProjectAccess = hasProjectAccess as jest.Mock<
    (userId: string, projectId: string) => Promise<boolean>
  >;
  const mockedGetSignedDownloadUrl = getSignedDownloadUrl as jest.Mock<
    (key: string, expiresIn: number) => Promise<string>
  >;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.GRANT_DOCUMENT_DOWNLOAD_URL_EXPIRY_SECONDS;
  });

  it("returns 401 for unauthenticated users", async () => {
    mockedAuth.mockResolvedValue(null);

    const response = await GET({} as Request, {
      params: Promise.resolve({ id: "project-1" }),
    });

    expect(response.status).toBe(401);
    expect(mockedFindUnique).not.toHaveBeenCalled();
  });

  it("returns 404 when no grant document is linked", async () => {
    mockedAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockedFindUnique.mockResolvedValue({
      id: "project-1",
      grantDocumentKey: null,
    });
    mockedHasProjectAccess.mockResolvedValue(true);

    const response = await GET({} as Request, {
      params: Promise.resolve({ id: "project-1" }),
    });

    expect(response.status).toBe(404);
    expect(mockedGetSignedDownloadUrl).not.toHaveBeenCalled();
  });

  it("redirects to signed URL for authorized users", async () => {
    mockedAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockedFindUnique.mockResolvedValue({
      id: "project-1",
      grantDocumentKey: "projects/project-1/grant/grant-application-v1.pdf",
    });
    mockedHasProjectAccess.mockResolvedValue(true);
    mockedGetSignedDownloadUrl.mockResolvedValue("https://signed.example.com/file");

    process.env.GRANT_DOCUMENT_DOWNLOAD_URL_EXPIRY_SECONDS = "900";

    const response = await GET({} as Request, {
      params: Promise.resolve({ id: "project-1" }),
    });

    expect(mockedGetSignedDownloadUrl).toHaveBeenCalledWith(
      "projects/project-1/grant/grant-application-v1.pdf",
      900
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://signed.example.com/file");
  });
});