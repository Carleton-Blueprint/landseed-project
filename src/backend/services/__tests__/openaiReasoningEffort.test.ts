import { OPENAI_REASONING_EFFORTS, readReasoningEffortEnv } from "lib/openaiReasoningEffort";

describe("readReasoningEffortEnv", () => {
  const ENV = "TEST_OPENAI_REASONING_EFFORT";

  afterEach(() => {
    delete process.env[ENV];
    jest.restoreAllMocks();
  });

  it("returns null when unset or blank", () => {
    delete process.env[ENV];
    expect(readReasoningEffortEnv(ENV)).toBeNull();
    process.env[ENV] = "  ";
    expect(readReasoningEffortEnv(ENV)).toBeNull();
  });

  it.each(OPENAI_REASONING_EFFORTS)("accepts %s", (effort) => {
    process.env[ENV] = effort;
    expect(readReasoningEffortEnv(ENV)).toBe(effort);
  });

  it("trims and lowercases", () => {
    process.env[ENV] = " HIGH ";
    expect(readReasoningEffortEnv(ENV)).toBe("high");
  });

  it("returns null for an invalid value and warns only once per value", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env[ENV] = "minimal-ish";

    expect(readReasoningEffortEnv(ENV)).toBeNull();
    expect(readReasoningEffortEnv(ENV)).toBeNull();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(ENV));
  });
});
