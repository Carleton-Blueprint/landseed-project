/**
 * @jest-environment node
 */
import { mapBuilderTrendStatus, BUILDERTREND_STATUS_MAP } from "../buildertrendStatusMapping";

describe("mapBuilderTrendStatus", () => {
  it.each(Object.entries(BUILDERTREND_STATUS_MAP))(
    "maps known status %s to %s",
    (externalStatus, internalStatus) => {
      expect(mapBuilderTrendStatus(externalStatus)).toBe(internalStatus);
    }
  );

  it("is case-insensitive: lowercase input maps the same as uppercase", () => {
    expect(mapBuilderTrendStatus("scheduled")).toBe("WORK_SCHEDULED");
    expect(mapBuilderTrendStatus("in_progress")).toBe("WORK_IN_PROGRESS");
    expect(mapBuilderTrendStatus("on_hold")).toBe("WORK_ON_HOLD");
    expect(mapBuilderTrendStatus("completed")).toBe("WORK_COMPLETED");
    expect(mapBuilderTrendStatus("cancelled")).toBe("WORK_CANCELLED");
  });

  it("is case-insensitive: mixed-case input maps the same as uppercase", () => {
    expect(mapBuilderTrendStatus("ScHeDuLeD")).toBe("WORK_SCHEDULED");
    expect(mapBuilderTrendStatus("In_Progress")).toBe("WORK_IN_PROGRESS");
  });

  it("returns null for an unrecognized status", () => {
    expect(mapBuilderTrendStatus("SOMETHING_UNKNOWN")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(mapBuilderTrendStatus("")).toBeNull();
  });
});
