import { compareCodes } from "@/backend/services/photoCodeComparison";

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
