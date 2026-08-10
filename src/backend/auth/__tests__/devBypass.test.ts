import { isDevAuthBypassEnabled } from "@/backend/auth/devBypass";

// Next.js's global.d.ts types process.env.NODE_ENV as readonly; defineProperty
// bypasses that for tests without weakening the type everywhere else.
function setNodeEnv(value: string | undefined) {
  Object.defineProperty(process.env, "NODE_ENV", { value, configurable: true });
}

describe("isDevAuthBypassEnabled", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    delete process.env.DEV_AUTH_BYPASS;
  });

  afterEach(() => {
    setNodeEnv(originalNodeEnv);
    delete process.env.DEV_AUTH_BYPASS;
  });

  it("returns false when DEV_AUTH_BYPASS is unset", () => {
    setNodeEnv("development");
    expect(isDevAuthBypassEnabled()).toBe(false);
  });

  it("returns true in development when DEV_AUTH_BYPASS=true", () => {
    setNodeEnv("development");
    process.env.DEV_AUTH_BYPASS = "true";
    expect(isDevAuthBypassEnabled()).toBe(true);
  });

  it("returns false in production even when DEV_AUTH_BYPASS=true", () => {
    setNodeEnv("production");
    process.env.DEV_AUTH_BYPASS = "true";
    expect(isDevAuthBypassEnabled()).toBe(false);
  });
});
