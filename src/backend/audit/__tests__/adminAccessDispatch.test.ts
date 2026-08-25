import { describe, expect, it, jest, beforeEach, afterEach } from "@jest/globals";
import type { NextFetchEvent } from "next/server";
import type { AdminAccessDeniedInput } from "@/backend/audit/adminAccess";

import { queueDeniedAdminAccessAudit } from "../adminAccessDispatch";

function makeFetchEvent(): NextFetchEvent & { waitUntil: jest.Mock } {
  return {
    waitUntil: jest.fn(),
  } as unknown as NextFetchEvent & { waitUntil: jest.Mock };
}

function makeInput(overrides: Partial<AdminAccessDeniedInput> = {}): AdminAccessDeniedInput {
  return {
    surface: "route",
    actorUserId: "user-1",
    routePath: "/api/admin/audit/verify",
    method: "GET",
    resourceType: "AdminRoute",
    resourceId: "/api/admin/audit/verify",
    reason: "forbidden",
    ...overrides,
  };
}

describe("queueDeniedAdminAccessAudit", () => {
  const originalFetch = global.fetch;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    consoleErrorSpy.mockRestore();
  });

  it("dispatches a POST to the internal audit endpoint resolved against request.url", () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as unknown as typeof fetch;

    const event = makeFetchEvent();
    const request = { url: "https://example.com/api/admin/eligibility/assess" } as Request;
    const input = makeInput();

    queueDeniedAdminAccessAudit(event, request, input);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [urlArg, initArg] = fetchMock.mock.calls[0] as [URL, RequestInit];

    expect(urlArg).toBeInstanceOf(URL);
    expect(urlArg.toString()).toBe(
      "https://example.com/api/internal/audit/admin-access-denied"
    );
    expect(initArg.method).toBe("POST");
    expect(initArg.headers).toEqual({ "content-type": "application/json" });
    expect(initArg.body).toBe(JSON.stringify(input));
  });

  it("calls event.waitUntil with the fetch promise", () => {
    const fetchPromise = Promise.resolve({ ok: true });
    const fetchMock = jest.fn().mockReturnValue(fetchPromise);
    global.fetch = fetchMock as unknown as typeof fetch;

    const event = makeFetchEvent();
    const request = { url: "https://example.com/api/admin/audit/verify" } as Request;

    queueDeniedAdminAccessAudit(event, request, makeInput());

    expect(event.waitUntil).toHaveBeenCalledTimes(1);
    const passedPromise = event.waitUntil.mock.calls[0][0] as Promise<unknown>;
    expect(passedPromise).toBeInstanceOf(Promise);
  });

  it("catches a rejected fetch instead of throwing, and logs it via console.error", async () => {
    const fetchError = new Error("network down");
    const fetchMock = jest.fn().mockRejectedValue(fetchError);
    global.fetch = fetchMock as unknown as typeof fetch;

    const event = makeFetchEvent();
    const request = { url: "https://example.com/api/admin/audit/verify" } as Request;

    expect(() => {
      queueDeniedAdminAccessAudit(event, request, makeInput());
    }).not.toThrow();

    const passedPromise = event.waitUntil.mock.calls[0][0] as Promise<unknown>;

    // Flush the promise passed to waitUntil to observe the .catch() handler.
    await expect(passedPromise).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Admin access denied audit dispatch failed:",
      fetchError
    );
  });
});
