import {
  ADMIN_CUSTOM_EMAIL_MAX_MESSAGE_LENGTH,
  ADMIN_CUSTOM_EMAIL_MAX_SUBJECT_LENGTH,
  AdminCustomEmailError,
  sendAdminCustomEmail,
} from "../adminCustomEmail";
import { sendTransactionalEmail } from "@/backend/services/transactionalEmail";
import { logCommunication } from "@/backend/services/communicationHistoryLogger";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import { prisma } from "lib/prisma";

jest.mock("@/backend/services/transactionalEmail", () => ({
  sendTransactionalEmail: jest.fn(),
}));

jest.mock("@/backend/services/communicationHistoryLogger", () => ({
  logCommunication: jest.fn(),
}));

jest.mock("@/backend/audit/log", () => ({
  logAuditEventNonBlocking: jest.fn(() => Promise.resolve(undefined)),
}));

jest.mock("lib/prisma", () => ({
  prisma: {
    project: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    projectAccess: { findUnique: jest.fn() },
  },
}));

describe("sendAdminCustomEmail", () => {
  const mockedPrisma = prisma as unknown as {
    project: { findUnique: jest.Mock };
    user: { findUnique: jest.Mock };
    projectAccess: { findUnique: jest.Mock };
  };
  const mockedSendTransactionalEmail = sendTransactionalEmail as jest.MockedFunction<typeof sendTransactionalEmail>;
  const mockedLogCommunication = logCommunication as jest.MockedFunction<typeof logCommunication>;
  const mockedLogAudit = logAuditEventNonBlocking as jest.MockedFunction<typeof logAuditEventNonBlocking>;

  const project = { id: "project-1", userId: "owner-1" };
  const recipient = { id: "owner-1", name: "Client", email: "client@example.com" };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.project.findUnique.mockResolvedValue(project);
    mockedPrisma.user.findUnique.mockResolvedValue(recipient);
    mockedLogCommunication.mockResolvedValue("comm-1");
  });

  it("sends to the project owner and logs a SENT communication", async () => {
    mockedSendTransactionalEmail.mockResolvedValue({ provider: "resend", messageId: "msg-1" });

    const result = await sendAdminCustomEmail({
      projectId: "project-1",
      recipientId: "owner-1",
      subject: "Update on your project",
      message: "Here is an update.",
      senderId: "admin-1",
    });

    expect(result).toEqual({
      communicationId: "comm-1",
      delivered: true,
      provider: "resend",
      messageId: "msg-1",
    });
    expect(mockedSendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "client@example.com", subject: "Update on your project" })
    );
    expect(mockedLogCommunication).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        communicationType: "EMAIL",
        recipientId: "owner-1",
        recipientEmail: "client@example.com",
        senderId: "admin-1",
        status: "SENT",
      })
    );
    expect(mockedLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ADMIN_CUSTOM_EMAIL_SENT", outcome: "SUCCESS" })
    );
  });

  it("allows a recipient with project access who is not the owner", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({ id: "caregiver-1", name: "Caregiver", email: "caregiver@example.com" });
    mockedPrisma.projectAccess.findUnique.mockResolvedValue({ id: "access-1" });
    mockedSendTransactionalEmail.mockResolvedValue({ provider: "resend" });

    const result = await sendAdminCustomEmail({
      projectId: "project-1",
      recipientId: "caregiver-1",
      subject: "Update",
      message: "Hello",
      senderId: "admin-1",
    });

    expect(result.delivered).toBe(true);
    expect(mockedPrisma.projectAccess.findUnique).toHaveBeenCalledWith({
      where: { projectId_userId: { projectId: "project-1", userId: "caregiver-1" } },
      select: { id: true },
    });
  });

  it("rejects a recipient without project access", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({ id: "stranger-1", name: "Stranger", email: "stranger@example.com" });
    mockedPrisma.projectAccess.findUnique.mockResolvedValue(null);

    await expect(
      sendAdminCustomEmail({
        projectId: "project-1",
        recipientId: "stranger-1",
        subject: "Update",
        message: "Hello",
        senderId: "admin-1",
      })
    ).rejects.toMatchObject({ statusCode: 400, code: "RECIPIENT_NOT_ON_PROJECT" });

    expect(mockedSendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("rejects a missing recipient", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(null);

    await expect(
      sendAdminCustomEmail({
        projectId: "project-1",
        recipientId: "missing",
        subject: "Update",
        message: "Hello",
        senderId: "admin-1",
      })
    ).rejects.toMatchObject({ statusCode: 404, code: "RECIPIENT_NOT_FOUND" });
  });

  it("rejects a missing project", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue(null);

    await expect(
      sendAdminCustomEmail({
        projectId: "missing-project",
        recipientId: "owner-1",
        subject: "Update",
        message: "Hello",
        senderId: "admin-1",
      })
    ).rejects.toMatchObject({ statusCode: 404, code: "PROJECT_NOT_FOUND" });
  });

  it("rejects a recipient with no email on file", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({ id: "owner-1", name: "Client", email: null });

    await expect(
      sendAdminCustomEmail({
        projectId: "project-1",
        recipientId: "owner-1",
        subject: "Update",
        message: "Hello",
        senderId: "admin-1",
      })
    ).rejects.toMatchObject({ statusCode: 400, code: "RECIPIENT_HAS_NO_EMAIL" });
  });

  it.each([
    [undefined, "INVALID_SUBJECT"],
    ["   ", "INVALID_SUBJECT"],
    ["a".repeat(ADMIN_CUSTOM_EMAIL_MAX_SUBJECT_LENGTH + 1), "INVALID_SUBJECT"],
  ])("rejects invalid subject %p", async (subject, code) => {
    await expect(
      sendAdminCustomEmail({
        projectId: "project-1",
        recipientId: "owner-1",
        subject,
        message: "Hello",
        senderId: "admin-1",
      })
    ).rejects.toMatchObject({ code });
  });

  it.each([
    [undefined, "INVALID_MESSAGE"],
    ["   ", "INVALID_MESSAGE"],
    ["a".repeat(ADMIN_CUSTOM_EMAIL_MAX_MESSAGE_LENGTH + 1), "INVALID_MESSAGE"],
  ])("rejects invalid message %p", async (message, code) => {
    await expect(
      sendAdminCustomEmail({
        projectId: "project-1",
        recipientId: "owner-1",
        subject: "Update",
        message,
        senderId: "admin-1",
      })
    ).rejects.toMatchObject({ code });
  });

  it("logs a FAILED communication and returns a delivery error when the email provider throws", async () => {
    mockedSendTransactionalEmail.mockRejectedValue(new Error("Resend request failed with status 500"));

    const result = await sendAdminCustomEmail({
      projectId: "project-1",
      recipientId: "owner-1",
      subject: "Update",
      message: "Hello",
      senderId: "admin-1",
    });

    expect(result).toEqual({
      communicationId: "comm-1",
      delivered: false,
      deliveryError: "Resend request failed with status 500",
    });
    expect(mockedLogCommunication).toHaveBeenCalledWith(
      expect.objectContaining({ status: "FAILED" })
    );
    expect(mockedLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ADMIN_CUSTOM_EMAIL_SENT", outcome: "FAILURE" })
    );
  });

  it("throws AdminCustomEmailError instances (not generic Error) for validation failures", async () => {
    await expect(
      sendAdminCustomEmail({
        projectId: "project-1",
        recipientId: "owner-1",
        subject: "",
        message: "Hello",
        senderId: "admin-1",
      })
    ).rejects.toBeInstanceOf(AdminCustomEmailError);
  });
});
