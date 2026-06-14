import { GET, POST } from "../route";
import { NextRequest } from "next/server";
import { prisma } from "lib/prisma";
import { auth } from "@/auth";
import { hasProjectAccess } from "@/backend/auth/projectAccess";

jest.mock("lib/prisma", () => ({
  prisma: {
    consultationRequest: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  },
}));

jest.mock("@/auth", () => ({
  auth: jest.fn(),
}));

jest.mock("@/backend/auth/projectAccess", () => ({
  hasProjectAccess: jest.fn(),
}));

const originalEnv = process.env.NODE_ENV;

describe("Consultation Request API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = "production";
  });

  afterAll(() => {
    process.env.NODE_ENV = originalEnv;
  });

  describe("GET", () => {
    it("returns 401 if unauthorized", async () => {
      (auth as jest.Mock).mockResolvedValue(null);

      const req = new NextRequest("http://localhost/api/project/proj-123/consultation");
      const res = await GET(req, { params: Promise.resolve({ id: "proj-123" }) });

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 403 if user lacks access to the project", async () => {
      (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
      (hasProjectAccess as jest.Mock).mockResolvedValue(false);

      const req = new NextRequest("http://localhost/api/project/proj-123/consultation");
      const res = await GET(req, { params: Promise.resolve({ id: "proj-123" }) });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe("Forbidden");
    });

    it("returns the consultation request when it exists", async () => {
      const mockConsultation = {
        id: "c-1",
        projectId: "proj-123",
        scheduledAt: new Date("2026-06-15T10:00:00Z"),
        status: "PENDING",
      };
      (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
      (hasProjectAccess as jest.Mock).mockResolvedValue(true);
      (prisma.consultationRequest.findUnique as jest.Mock).mockResolvedValue(mockConsultation);

      const req = new NextRequest("http://localhost/api/project/proj-123/consultation");
      const res = await GET(req, { params: Promise.resolve({ id: "proj-123" }) });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.consultation).toEqual({
        ...mockConsultation,
        scheduledAt: mockConsultation.scheduledAt.toISOString(),
      });
    });
  });

  describe("POST", () => {
    it("creates or updates a consultation request when request is valid", async () => {
      const mockConsultation = {
        id: "c-1",
        projectId: "proj-123",
        scheduledAt: new Date("2026-06-15T10:00:00Z"),
        status: "PENDING",
      };
      (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
      (hasProjectAccess as jest.Mock).mockResolvedValue(true);
      (prisma.consultationRequest.upsert as jest.Mock).mockResolvedValue(mockConsultation);

      const req = new NextRequest("http://localhost/api/project/proj-123/consultation", {
        method: "POST",
        body: JSON.stringify({
          scheduledAt: "2026-06-15T10:00:00Z",
          notes: "Need budget approval",
        }),
      });

      const res = await POST(req, { params: Promise.resolve({ id: "proj-123" }) });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.consultation).toBeDefined();
    });

    it("returns 400 if scheduledAt is missing", async () => {
      (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
      (hasProjectAccess as jest.Mock).mockResolvedValue(true);

      const req = new NextRequest("http://localhost/api/project/proj-123/consultation", {
        method: "POST",
        body: JSON.stringify({
          notes: "Need budget approval",
        }),
      });

      const res = await POST(req, { params: Promise.resolve({ id: "proj-123" }) });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("scheduledAt is required");
    });
  });
});
