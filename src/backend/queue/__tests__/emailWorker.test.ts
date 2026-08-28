/**
 * Verifies the email worker's job.data -> processNotification mapping without
 * touching real Redis: mocks bullmq/ioredis to capture the "email" queue's
 * processor callback, then invokes it directly with a fake job.
 */
import { NotificationEventType } from "@prisma/client";

type WorkerConstructorCall = { name: string; processor: (job: unknown) => Promise<void> };

const workerConstructorCalls: WorkerConstructorCall[] = [];

jest.mock("ioredis", () => jest.fn().mockImplementation(() => ({})));

jest.mock("bullmq", () => ({
  Queue: jest.fn().mockImplementation(function () {
    return {};
  }),
  Worker: jest.fn().mockImplementation(function (
    this: unknown,
    name: string,
    processor: (job: unknown) => Promise<void>
  ) {
    workerConstructorCalls.push({ name, processor });
    return { on: jest.fn(), close: jest.fn() };
  }),
}));

jest.mock("@/backend/notifications/service", () => ({
  processNotification: jest.fn(),
}));

jest.mock("@/backend/services/criticalFailureAlerts", () => ({
  recordFailureAndMaybeAlert: jest.fn(),
}));

jest.mock("@/backend/services/alertThresholds", () => ({
  ALERT_THRESHOLD_KEYS: { EMAIL_DELIVERY_FAILURE: "EMAIL_DELIVERY_FAILURE" },
}));

describe("email worker job.data mapping", () => {
  beforeAll(async () => {
    await import("../emailWorker");
  });

  it("forwards questionCategory/questionSubject/fileName/documentType from job.data to processNotification", async () => {
    const { processNotification } = jest.requireMock("@/backend/notifications/service") as {
      processNotification: jest.Mock;
    };

    const call = workerConstructorCalls.find((c) => c.name === "email");
    expect(call).toBeDefined();

    const jobData = {
      eventType: NotificationEventType.QUESTION_SUBMITTED_FOR_ADVISORY_TEAM,
      idempotencyKey: "idem-1",
      recipientEmail: "advisor@example.com",
      questionCategory: "Bathroom Safety",
      questionSubject: "Grab bar placement",
      fileName: "floorplan.pdf",
      documentType: "Floor Plan",
    };

    await call!.processor({ data: jobData });

    expect(processNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        questionCategory: "Bathroom Safety",
        questionSubject: "Grab bar placement",
        fileName: "floorplan.pdf",
        documentType: "Floor Plan",
      })
    );
  });
});
