export {};

jest.mock("@/auth", () => ({
  auth: jest.fn(),
}));

jest.mock("@/backend/auth/requireRole", () => ({
  HttpError: class HttpError extends Error {
    status: number;
    constructor(message: string, status = 403) {
      super(message);
      this.status = status;
    }
  },
}));

jest.mock("@/backend/auth/requireAdminMfa", () => ({
  MfaSetupRequiredError: class MfaSetupRequiredError extends Error {
    status = 403;
    code = "MFA_SETUP_REQUIRED";
  },
  requireAdminWithMfaEnrolled: jest.fn(),
}));

jest.mock("@/backend/audit/requestContext", () => ({
  getRequestAuditContext: jest.fn(() => ({ ipAddress: "198.51.100.2", userAgent: "jest" })),
}));

jest.mock("@/backend/audit/adminAccess", () => ({
  logDeniedAdminAccessAttempt: jest.fn(() => Promise.resolve(undefined)),
}));

jest.mock("@/backend/services/alertThresholds", () => ({
  AlertThresholdError: class AlertThresholdError extends Error {
    statusCode: number;
    code: string;
    constructor(message: string, statusCode: number, code: string) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
  },
  getAllAlertThresholds: jest.fn(),
  updateAlertThreshold: jest.fn(),
}));

const { GET, PATCH } = require("../route");
const { auth } = require("@/auth");
const { HttpError } = require("@/backend/auth/requireRole");
const { requireAdminWithMfaEnrolled, MfaSetupRequiredError } = require("@/backend/auth/requireAdminMfa");
const { logDeniedAdminAccessAttempt } = require("@/backend/audit/adminAccess");
const {
  getAllAlertThresholds,
  updateAlertThreshold,
  AlertThresholdError,
} = require("@/backend/services/alertThresholds");

const adminSession = { user: { id: "admin-1", email: "advisor@landseed.test" } };

function buildRequest(method: string, body?: Record<string, unknown>): Request {
  return {
    url: "https://example.com/api/admin/alert-thresholds",
    method,
    headers: { get: () => "application/json" },
    json: jest.fn(() => Promise.resolve(body)),
  } as unknown as Request;
}

describe("/api/admin/alert-thresholds", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requireAdminWithMfaEnrolled as jest.Mock).mockResolvedValue(true);
  });

  describe("GET", () => {
    it("logs denied access and returns 401 for unauthenticated requests", async () => {
      (auth as jest.Mock).mockResolvedValue(null);
      (requireAdminWithMfaEnrolled as jest.Mock).mockRejectedValue(new HttpError("unauthenticated", 401));

      const response = await GET(buildRequest("GET"));

      expect(response.status).toBe(401);
      expect(logDeniedAdminAccessAttempt).toHaveBeenCalledWith(
        expect.objectContaining({
          surface: "route",
          actorUserId: null,
          routePath: "/api/admin/alert-thresholds",
          method: "GET",
          resourceType: "AlertThresholdConfig",
        })
      );
      expect(getAllAlertThresholds).not.toHaveBeenCalled();
    });

    it("returns the threshold list for an enrolled admin", async () => {
      (auth as jest.Mock).mockResolvedValue(adminSession);
      (getAllAlertThresholds as jest.Mock).mockResolvedValue([
        { key: "ai-job-failure", label: "AI job failures", thresholdCount: 5, windowMinutes: 15, enabled: true },
      ]);

      const response = await GET(buildRequest("GET"));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.thresholds).toHaveLength(1);
    });
  });

  describe("PATCH", () => {
    it("returns 403 with the MFA_SETUP_REQUIRED code when the actor hasn't enrolled MFA", async () => {
      (auth as jest.Mock).mockResolvedValue(adminSession);
      (requireAdminWithMfaEnrolled as jest.Mock).mockRejectedValue(new MfaSetupRequiredError());

      const response = await PATCH(buildRequest("PATCH", { key: "ai-job-failure", thresholdCount: 10 }));
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.code).toBe("MFA_SETUP_REQUIRED");
      expect(updateAlertThreshold).not.toHaveBeenCalled();
    });

    it("returns 400 when key is missing", async () => {
      (auth as jest.Mock).mockResolvedValue(adminSession);

      const response = await PATCH(buildRequest("PATCH", { thresholdCount: 10 }));

      expect(response.status).toBe(400);
      expect(updateAlertThreshold).not.toHaveBeenCalled();
    });

    it("updates the threshold and returns the result", async () => {
      (auth as jest.Mock).mockResolvedValue(adminSession);
      (updateAlertThreshold as jest.Mock).mockResolvedValue({
        key: "ai-job-failure",
        thresholdCount: 10,
        windowMinutes: 15,
        enabled: true,
      });

      const response = await PATCH(
        buildRequest("PATCH", { key: "ai-job-failure", thresholdCount: 10 })
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.threshold.thresholdCount).toBe(10);
      expect(updateAlertThreshold).toHaveBeenCalledWith({
        key: "ai-job-failure",
        thresholdCount: 10,
        windowMinutes: undefined,
        enabled: undefined,
        actorUserId: "admin-1",
      });
    });

    it("maps AlertThresholdError to its status code and error code", async () => {
      (auth as jest.Mock).mockResolvedValue(adminSession);
      (updateAlertThreshold as jest.Mock).mockRejectedValue(
        new AlertThresholdError("Unknown alert threshold key: bogus", 404, "NOT_FOUND")
      );

      const response = await PATCH(buildRequest("PATCH", { key: "bogus", thresholdCount: 10 }));
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body).toEqual({ error: "Unknown alert threshold key: bogus", code: "NOT_FOUND" });
    });
  });
});
