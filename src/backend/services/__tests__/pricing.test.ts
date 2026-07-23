import { getMaterialPrice } from "@/backend/services/pricing";

const mockFetch = jest.fn();

function shoppingResponse(shopping_results: unknown[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ shopping_results }),
  };
}

describe("getMaterialPrice", () => {
  const originalApiKey = process.env.SERP_API_KEY;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SERP_API_KEY = "test-key";
    global.fetch = mockFetch as typeof fetch;
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.SERP_API_KEY = originalApiKey;
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("returns the cheapest preferred-store item and logs a success cost entry", async () => {
    mockFetch.mockResolvedValue(
      shoppingResponse([
        { title: "Grab bar (AliExpress)", price: "$8.79", source: "AliExpress", product_link: "https://a.example" },
        { title: "Grab bar (Amazon)", price: "$11.88", source: "Amazon CA", product_link: "https://b.example" },
        { title: "Grab bar (Home Depot)", price: "$16.09", source: "Home Depot", product_link: "https://c.example" },
      ])
    );

    const result = await getMaterialPrice("grab bars");

    expect(result.status).toBe("ok");
    expect(result.store).toBe("Home Depot");
    expect(result.price).toBe(16.09);
    expect(result.link).toBe("https://c.example");

    const costLog = consoleLogSpy.mock.calls.find((call) => String(call[0]).includes("[PRICING:COST"));
    expect(costLog?.[0]).toContain("outcome=success");
  });

  it("falls back to the cheapest overall item when no preferred store is present", async () => {
    mockFetch.mockResolvedValue(
      shoppingResponse([
        { title: "Grab bar (AliExpress)", price: "$8.79", source: "AliExpress", product_link: "https://a.example" },
        { title: "Grab bar (Amazon)", price: "$11.88", source: "Amazon CA", product_link: "https://b.example" },
      ])
    );

    const result = await getMaterialPrice("grab bars");

    expect(result.status).toBe("ok");
    expect(result.store).toBe("AliExpress");
    expect(result.price).toBe(8.79);
    expect(result.link).toBe("https://a.example");
  });

  it("returns an empty status when shopping_results is empty", async () => {
    mockFetch.mockResolvedValue(shoppingResponse([]));

    const result = await getMaterialPrice("nonexistent material");

    expect(result.status).toBe("empty");
    expect(result.price).toBeNull();
    expect(result.store).toBeNull();

    const costLog = consoleLogSpy.mock.calls.find((call) => String(call[0]).includes("[PRICING:COST"));
    expect(costLog?.[0]).toContain("outcome=empty");
  });

  it("returns an empty status when no result has a parseable price", async () => {
    mockFetch.mockResolvedValue(
      shoppingResponse([{ title: "Mystery item", price: undefined, source: "Home Depot" }])
    );

    const result = await getMaterialPrice("mystery item");

    expect(result.status).toBe("empty");
  });

  it("returns an error status and logs an http_error entry on a non-OK response", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });

    const result = await getMaterialPrice("grab bars");

    expect(result.status).toBe("error");
    expect(result.price).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalled();

    const costLog = consoleLogSpy.mock.calls.find((call) => String(call[0]).includes("[PRICING:COST"));
    expect(costLog?.[0]).toContain("outcome=http_error");
  });

  it("returns an error status and logs a missing_key entry when SERP_API_KEY is unset", async () => {
    delete process.env.SERP_API_KEY;

    const result = await getMaterialPrice("grab bars");

    expect(result.status).toBe("error");
    expect(mockFetch).not.toHaveBeenCalled();

    const costLog = consoleLogSpy.mock.calls.find((call) => String(call[0]).includes("[PRICING:COST"));
    expect(costLog?.[0]).toContain("outcome=missing_key");
  });

  it("returns an error status and logs a network_error entry when fetch rejects", async () => {
    mockFetch.mockRejectedValue(new Error("network down"));

    const result = await getMaterialPrice("grab bars");

    expect(result.status).toBe("error");

    const costLog = consoleLogSpy.mock.calls.find((call) => String(call[0]).includes("[PRICING:COST"));
    expect(costLog?.[0]).toContain("outcome=network_error");
  });

  it("rejects for an empty or whitespace-only query without calling fetch", async () => {
    await expect(getMaterialPrice("   ")).rejects.toThrow("Invalid query");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
