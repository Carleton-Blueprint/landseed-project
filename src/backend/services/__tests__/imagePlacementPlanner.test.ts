import { getOpenAIClient } from "lib/openai";
import {
  PLACEMENT_PLANNER_PROMPT_VERSION,
  buildPlacementPlannerPrompt,
  normalizePlacementPlan,
  planModificationPlacement,
} from "../imagePlacementPlanner";

jest.mock("lib/openai", () => ({
  getOpenAIClient: jest.fn(),
}));

const mockedGetOpenAIClient = getOpenAIClient as jest.Mock;

const source = { buffer: Buffer.from("jpeg-bytes"), mimeType: "image/jpeg" };

describe("buildPlacementPlannerPrompt", () => {
  it("lists each requested code with its typical installation and asks for boxes", () => {
    const prompt = buildPlacementPlannerPrompt(["GRAB_BARS", "STAIR_LIFT"]);
    expect(prompt).toContain("- GRAB_BARS (Grab Bars). Typical installation: Only on the wall directly beside the toilet");
    expect(prompt).toContain("- STAIR_LIFT (Stair Lift).");
    expect(prompt).toContain('"box"');
    expect(prompt).toContain('"applicable"');
  });
});

describe("normalizePlacementPlan", () => {
  it("keeps only requested codes, first entry wins", () => {
    const plan = normalizePlacementPlan(
      {
        visibleElements: ["toilet", "", 42, "vanity"],
        placements: [
          { modificationCode: "GRAB_BARS", applicable: true, placement: "Right of toilet", box: null },
          { modificationCode: "GRAB_BARS", applicable: true, placement: "Duplicate", box: null },
          { modificationCode: "RAMP", applicable: true, placement: "Not requested", box: null },
        ],
      },
      ["GRAB_BARS"]
    );

    expect(plan).toEqual({
      visibleElements: ["toilet", "vanity"],
      placements: [
        { modificationCode: "GRAB_BARS", applicable: true, placement: "Right of toilet", box: null, reason: null },
      ],
    });
  });

  it("clamps boxes to the image and drops malformed ones", () => {
    const plan = normalizePlacementPlan(
      {
        placements: [
          { modificationCode: "GRAB_BARS", placement: "a", box: { x: 0.8, y: -0.1, width: 0.5, height: 0.3 } },
          { modificationCode: "HANDRAILS", placement: "b", box: { x: "0.1", y: 0.1, width: 0.2, height: 0.2 } },
          { modificationCode: "RAMP", placement: "c", box: { x: 0.2, y: 0.2, width: 0, height: 0.2 } },
        ],
      },
      ["GRAB_BARS", "HANDRAILS", "RAMP"]
    );

    expect(plan!.placements[0].box!.x).toBeCloseTo(0.8);
    expect(plan!.placements[0].box!.y).toBe(0);
    expect(plan!.placements[0].box!.width).toBeCloseTo(0.2);
    expect(plan!.placements[0].box!.height).toBeCloseTo(0.3);
    expect(plan!.placements[1].box).toBeNull();
    expect(plan!.placements[2].box).toBeNull();
  });

  it("nulls placement and box for not-applicable entries", () => {
    const plan = normalizePlacementPlan(
      {
        placements: [
          {
            modificationCode: "STAIR_LIFT",
            applicable: false,
            placement: "ignored",
            box: { x: 0, y: 0, width: 1, height: 1 },
            reason: "No stairs visible",
          },
        ],
      },
      ["STAIR_LIFT"]
    );

    expect(plan!.placements[0]).toEqual({
      modificationCode: "STAIR_LIFT",
      applicable: false,
      placement: null,
      box: null,
      reason: "No stairs visible",
    });
  });

  it("returns null when nothing usable is left", () => {
    expect(normalizePlacementPlan(null, ["GRAB_BARS"])).toBeNull();
    expect(normalizePlacementPlan({ placements: "nope" }, ["GRAB_BARS"])).toBeNull();
    expect(normalizePlacementPlan({ placements: [{ modificationCode: "RAMP" }] }, ["GRAB_BARS"])).toBeNull();
  });
});

describe("planModificationPlacement", () => {
  let mockCreate: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate = jest.fn();
    mockedGetOpenAIClient.mockReturnValue({ chat: { completions: { create: mockCreate } } });
  });

  it("sends the photo as a data URL in JSON mode and returns the normalized plan", async () => {
    const rawResponse = JSON.stringify({
      visibleElements: ["toilet"],
      placements: [
        {
          modificationCode: "GRAB_BARS",
          applicable: true,
          placement: "One horizontal bar on the wall right of the toilet",
          box: { x: 0.6, y: 0.4, width: 0.2, height: 0.08 },
        },
      ],
    });
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: rawResponse } }],
      usage: { prompt_tokens: 900, completion_tokens: 120 },
    });

    const result = await planModificationPlacement(source, ["GRAB_BARS", "GRAB_BARS"]);

    const [request] = mockCreate.mock.calls[0];
    expect(request.response_format).toEqual({ type: "json_object" });
    expect(request.messages[0].content[1].image_url.url).toBe(
      `data:image/jpeg;base64,${source.buffer.toString("base64")}`
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: "READY",
        rawResponse,
        promptVersion: PLACEMENT_PLANNER_PROMPT_VERSION,
        usage: { promptTokens: 900, completionTokens: 120 },
      })
    );
    expect(result.status === "READY" && result.plan.placements[0].box).toEqual({
      x: 0.6,
      y: 0.4,
      width: 0.2,
      height: 0.08,
    });
  });

  it("returns FAILED (never throws) when the call rejects", async () => {
    mockCreate.mockRejectedValue(new Error("OpenAI timeout"));

    const result = await planModificationPlacement(source, ["GRAB_BARS"]);

    expect(result).toEqual(expect.objectContaining({ status: "FAILED", error: "OpenAI timeout", rawResponse: null }));
  });

  it("returns FAILED with the raw response when it isn't valid JSON", async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: "not json" } }] });

    const result = await planModificationPlacement(source, ["GRAB_BARS"]);

    expect(result).toEqual(
      expect.objectContaining({ status: "FAILED", error: "Failed to parse placement plan as JSON", rawResponse: "not json" })
    );
  });

  it("returns FAILED when the plan has no usable entries", async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ placements: [] }) } }] });

    const result = await planModificationPlacement(source, ["GRAB_BARS"]);

    expect(result).toEqual(expect.objectContaining({ status: "FAILED", error: "Placement plan had no usable entries" }));
  });

  it("skips the call entirely when there are no codes", async () => {
    const result = await planModificationPlacement(source, []);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.status).toBe("FAILED");
  });
});
