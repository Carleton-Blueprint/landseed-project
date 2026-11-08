import { compareCodes, flaggedDeclaredCodes } from "@/backend/services/photoCodeComparison";

describe("compareCodes", () => {
  it("reports declared codes the AI didn't find as missing", () => {
    expect(compareCodes(["GRAB_BARS", "HANDRAILS"], ["GRAB_BARS"])).toEqual({
      missingCodes: ["HANDRAILS"],
      suggestedCodes: [],
    });
  });

  it("reports extra AI codes as suggestions, not missing", () => {
    expect(compareCodes(["GRAB_BARS"], ["GRAB_BARS", "NON_SLIP_FLOORING"])).toEqual({
      missingCodes: [],
      suggestedCodes: ["NON_SLIP_FLOORING"],
    });
  });

  it.each([
    [["RAMP"], ["WHEELCHAIR_RAMP"]],
    [["WHEELCHAIR_RAMP"], ["RAMP"]],
  ])("treats RAMP and WHEELCHAIR_RAMP as one code (declared %j, AI %j)", (declared, ai) => {
    expect(compareCodes(declared, ai)).toEqual({ missingCodes: [], suggestedCodes: [] });
  });

  it("keeps WALK_IN_TUB and WALK_IN_SHOWER separate", () => {
    expect(compareCodes(["WALK_IN_TUB"], ["WALK_IN_SHOWER"])).toEqual({
      missingCodes: ["WALK_IN_TUB"],
      suggestedCodes: ["WALK_IN_SHOWER"],
    });
  });
});

describe("flaggedDeclaredCodes", () => {
  it("uses the missing-code rule when there are no stored verdicts", () => {
    expect(flaggedDeclaredCodes(["GRAB_BARS", "RAMP"], ["WHEELCHAIR_RAMP"], null)).toEqual(["GRAB_BARS"]);
  });

  it("flags only HIGH-confidence NO verdicts", () => {
    const verdicts = [
      { code: "GRAB_BARS", verdict: "NO", confidence: "HIGH" },
      { code: "HANDRAILS", verdict: "NO", confidence: "MEDIUM" },
      { code: "RAMP", verdict: "CANT_TELL", confidence: "HIGH" },
    ];
    expect(flaggedDeclaredCodes(["GRAB_BARS", "HANDRAILS", "RAMP"], [], verdicts)).toEqual(["GRAB_BARS"]);
  });
});
