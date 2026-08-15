/**
 * Locks in the BuilderTrend transfer queue's retry configuration without touching
 * real Redis: mocks bullmq/ioredis and inspects the constructor args passed by
 * queue/index.ts.
 */
type ConstructorCall = { name: string; opts: Record<string, unknown> };

const queueConstructorCalls: ConstructorCall[] = [];

jest.mock("ioredis", () => jest.fn().mockImplementation(() => ({})));

jest.mock("bullmq", () => ({
  Queue: jest.fn().mockImplementation(function (this: unknown, name: string, opts: Record<string, unknown>) {
    queueConstructorCalls.push({ name, opts });
  }),
  Worker: jest.fn().mockImplementation(function () {
    return {};
  }),
}));

describe("builderTrendTransferQueue configuration", () => {
  beforeAll(() => {
    require("../index");
  });

  it("retries up to 3 times with exponential backoff", () => {
    const call = queueConstructorCalls.find((c) => c.name === "buildertrend-transfer");

    expect(call?.opts.defaultJobOptions).toEqual({
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
    });
  });
});
