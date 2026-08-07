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
    expect(mapBuilderTrendStatus("scheduled")).toBe("work_scheduled");
    expect(mapBuilderTrendStatus("in_progress")).toBe("work_in_progress");
    expect(mapBuilderTrendStatus("on_hold")).toBe("work_on_hold");
    expect(mapBuilderTrendStatus("completed")).toBe("work_completed");
    expect(mapBuilderTrendStatus("cancelled")).toBe("work_cancelled");
  });

  it("is case-insensitive: mixed-case input maps the same as uppercase", () => {
    expect(mapBuilderTrendStatus("ScHeDuLeD")).toBe("work_scheduled");
    expect(mapBuilderTrendStatus("In_Progress")).toBe("work_in_progress");
  });

  it("returns null for an unrecognized status", () => {
    expect(mapBuilderTrendStatus("SOMETHING_UNKNOWN")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(mapBuilderTrendStatus("")).toBeNull();
  });
});
