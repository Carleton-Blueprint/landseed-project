import { GET, POST, PATCH } from "../route";
import { prisma } from "lib/prisma";
import { auth } from "@/auth";
import {
  getIntakeDraft,
  getOrCreateIntakeDraft,
  mergeIntakeDraft,
} from "@/backend/services/intakeDraft";

jest.mock("lib/prisma", () => ({
  prisma: {
    intakeDraft: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock("@/auth", () => ({
  auth: jest.fn(),
}));

jest.mock("@/backend/services/intakeDraft", () => ({
  getIntakeDraft: jest.fn(),
  getOrCreateIntakeDraft: jest.fn(),
  mergeIntakeDraft: jest.fn(),
}));

const mockDraft = {
  id: "draft-1",
  userId: "user-1",
  guidedData: { mobilityAssistance: "yes" },
  intakeData: { name: "Jane" },
  projectId: null,
  createdAt: new Date("2026-06-20T10:00:00.000Z"),
  updatedAt: new Date("2026-06-20T12:00:00.000Z"),
};

describe("/api/intake-draft", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET", () => {
    it("returns 401 when unsigned", async () => {
      (auth as jest.Mock).mockResolvedValue(null);

      const res = await GET();

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Unauthorized" });
    });

    it("returns draft null for a new user", async () => {
      (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
      (getIntakeDraft as jest.Mock).mockResolvedValue(null);

      const res = await GET();

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ draft: null });
    });

    it("returns the saved draft when one exists", async () => {
      (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
      (getIntakeDraft as jest.Mock).mockResolvedValue(mockDraft);

      const res = await GET();

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({
        draftId: "draft-1",
        guidedData: { mobilityAssistance: "yes" },
        intakeData: { name: "Jane" },
        savedAt: mockDraft.updatedAt.toISOString(),
      });
    });
  });

  describe("POST", () => {
    it("returns 401 when unsigned", async () => {
      (auth as jest.Mock).mockResolvedValue(null);

      const res = await POST();

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Unauthorized" });
    });

    it("creates a draft and returns draftId", async () => {
      (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
      (getOrCreateIntakeDraft as jest.Mock).mockResolvedValue({
        ...mockDraft,
        guidedData: null,
        intakeData: null,
      });

      const res = await POST();

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.draftId).toBe("draft-1");
      expect(getOrCreateIntakeDraft).toHaveBeenCalledWith("user-1");
    });

    it("is idempotent and returns the same draftId", async () => {
      (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
      (getOrCreateIntakeDraft as jest.Mock).mockResolvedValue(mockDraft);

      const first = await POST();
      const second = await POST();

      const firstData = await first.json();
      const secondData = await second.json();

      expect(firstData.draftId).toBe("draft-1");
      expect(secondData.draftId).toBe("draft-1");
      expect(getOrCreateIntakeDraft).toHaveBeenCalledTimes(2);
    });
  });

  describe("PATCH", () => {
    it("returns 401 when unsigned", async () => {
      (auth as jest.Mock).mockResolvedValue(null);

      const res = await PATCH(
        new Request("http://localhost/api/intake-draft", {
          method: "PATCH",
          body: JSON.stringify({ guidedData: { mobilityAssistance: "yes" } }),
        })
      );

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Unauthorized" });
    });

    it("returns 422 when body has no sections", async () => {
      (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });

      const res = await PATCH(
        new Request("http://localhost/api/intake-draft", {
          method: "PATCH",
          body: JSON.stringify({}),
        })
      );

      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.error).toBe("Invalid draft data");
    });

    it("merges guidedData without wiping intakeData", async () => {
      (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
      (mergeIntakeDraft as jest.Mock).mockResolvedValue({
        ...mockDraft,
        guidedData: { mobilityAssistance: "no" },
        intakeData: { name: "Jane" },
      });

      const res = await PATCH(
        new Request("http://localhost/api/intake-draft", {
          method: "PATCH",
          body: JSON.stringify({ guidedData: { mobilityAssistance: "no" } }),
        })
      );

      expect(res.status).toBe(200);
      expect(mergeIntakeDraft).toHaveBeenCalledWith("user-1", {
        guidedData: { mobilityAssistance: "no" },
      });

      const data = await res.json();
      expect(data.guidedData).toEqual({ mobilityAssistance: "no" });
      expect(data.intakeData).toEqual({ name: "Jane" });
    });

    it("merges intakeData without wiping guidedData", async () => {
      (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
      (mergeIntakeDraft as jest.Mock).mockResolvedValue(mockDraft);

      const res = await PATCH(
        new Request("http://localhost/api/intake-draft", {
          method: "PATCH",
          body: JSON.stringify({ intakeData: { name: "Jane" } }),
        })
      );

      expect(res.status).toBe(200);
      expect(mergeIntakeDraft).toHaveBeenCalledWith("user-1", {
        intakeData: expect.objectContaining({ name: "Jane" }),
      });

      const data = await res.json();
      expect(data.guidedData).toEqual({ mobilityAssistance: "yes" });
      expect(data.intakeData).toEqual({ name: "Jane" });
    });
  });
});
