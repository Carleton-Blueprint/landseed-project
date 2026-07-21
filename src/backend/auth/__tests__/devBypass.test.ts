import { isDevAuthBypassEnabled } from "@/backend/auth/devBypass";

describe("isDevAuthBypassEnabled", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    delete process.env.DEV_AUTH_BYPASS;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    delete process.env.DEV_AUTH_BYPASS;
  });

  it("returns false when DEV_AUTH_BYPASS is unset", () => {
    process.env.NODE_ENV = "development";
    expect(isDevAuthBypassEnabled()).toBe(false);
  });

  it("returns true in development when DEV_AUTH_BYPASS=true", () => {
    process.env.NODE_ENV = "development";
    process.env.DEV_AUTH_BYPASS = "true";
    expect(isDevAuthBypassEnabled()).toBe(true);
  });

  it("returns false in production even when DEV_AUTH_BYPASS=true", () => {
    process.env.NODE_ENV = "production";
    process.env.DEV_AUTH_BYPASS = "true";
    expect(isDevAuthBypassEnabled()).toBe(false);
  });
});
