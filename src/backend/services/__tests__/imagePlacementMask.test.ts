import sharp from "sharp";
import type { PlacementPlan } from "../imagePlacementPlanner";
import {
  buildPlacementMask,
  buildPlacementMaskAuditMetadata,
  buildPlacementMaskForPlan,
  isImageEditMaskEnabled,
  normalizeImageOrientation,
  padPlacementBox,
} from "../imagePlacementMask";

async function alphaAt(png: Buffer, x: number, y: number): Promise<number> {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  return data[(y * info.width + x) * info.channels + 3];
}

async function solidJpeg(width: number, height: number, orientation?: number): Promise<Buffer> {
  const image = sharp({ create: { width, height, channels: 3, background: "#888" } }).jpeg();
  return (orientation ? image.withMetadata({ orientation }) : image).toBuffer();
}

const plan = (placements: PlacementPlan["placements"]): PlacementPlan => ({ visibleElements: [], placements });

describe("isImageEditMaskEnabled", () => {
  afterEach(() => {
    delete process.env.IMAGE_EDIT_MASK_ENABLED;
  });

  it("is off when unset", () => {
    delete process.env.IMAGE_EDIT_MASK_ENABLED;
    expect(isImageEditMaskEnabled()).toBe(false);
  });

  it.each(["true", "TRUE", " true "])("is on for %p", (value) => {
    process.env.IMAGE_EDIT_MASK_ENABLED = value;
    expect(isImageEditMaskEnabled()).toBe(true);
  });

  it.each(["false", "", "1", "yes"])("is off for %p", (value) => {
    process.env.IMAGE_EDIT_MASK_ENABLED = value;
    expect(isImageEditMaskEnabled()).toBe(false);
  });
});

describe("padPlacementBox", () => {
  it("pads every side and clamps to the image", () => {
    const padded = padPlacementBox({ x: 0.02, y: 0.5, width: 0.2, height: 0.48 }, 0.04);
    expect(padded.x).toBe(0);
    expect(padded.y).toBeCloseTo(0.46);
    expect(padded.width).toBeCloseTo(0.26);
    expect(padded.height).toBeCloseTo(0.54);
  });
});

describe("buildPlacementMask", () => {
  it("is an opaque PNG of the requested size with transparent holes for each box", async () => {
    const mask = await buildPlacementMask(200, 100, [
      { x: 0.5, y: 0.5, width: 0.25, height: 0.5 },
      { x: 0, y: 0, width: 0.1, height: 0.1 },
    ]);

    const meta = await sharp(mask).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(100);
    expect(meta.hasAlpha).toBe(true);

    expect(await alphaAt(mask, 120, 70)).toBe(0); // inside box 1
    expect(await alphaAt(mask, 5, 5)).toBe(0); // inside box 2
    expect(await alphaAt(mask, 60, 70)).toBe(255); // outside both
    expect(await alphaAt(mask, 199, 0)).toBe(255);
  });
});

describe("normalizeImageOrientation", () => {
  it("rotates EXIF-oriented photos so pixel dimensions match how they're viewed", async () => {
    const sideways = await solidJpeg(300, 200, 6); // stored landscape, viewed portrait
    const normalized = await normalizeImageOrientation(sideways);
    const meta = await sharp(normalized).metadata();
    expect([meta.width, meta.height]).toEqual([200, 300]);
  });

  it("returns the same buffer when no rotation is needed or bytes aren't an image", async () => {
    const upright = await solidJpeg(30, 20);
    expect(await normalizeImageOrientation(upright)).toBe(upright);

    const junk = Buffer.from("not an image");
    expect(await normalizeImageOrientation(junk)).toBe(junk);
  });
});

describe("buildPlacementMaskForPlan", () => {
  const bars = {
    modificationCode: "GRAB_BARS",
    applicable: true,
    placement: "Right of toilet",
    box: { x: 0.6, y: 0.4, width: 0.2, height: 0.1 },
    reason: null,
  };
  const stairLift = {
    modificationCode: "STAIR_LIFT",
    applicable: false,
    placement: null,
    box: null,
    reason: "No stairs",
  };

  it("builds a mask the size of the source with padded boxes for applicable entries only", async () => {
    const source = await solidJpeg(400, 300);
    const result = await buildPlacementMaskForPlan(source, plan([bars, stairLift]));

    expect(result.applied).toBe(true);
    if (!result.applied) return;
    expect(result.boxes).toHaveLength(1);
    expect(result.boxes[0].x).toBeCloseTo(0.56);
    const meta = await sharp(result.mask).metadata();
    expect([meta.width, meta.height]).toEqual([400, 300]);
    expect(await alphaAt(result.mask, 280, 135)).toBe(0);
    expect(await alphaAt(result.mask, 20, 20)).toBe(255);
  });

  it("explains why no mask was built", async () => {
    const source = await solidJpeg(40, 30);
    expect(await buildPlacementMaskForPlan(source, null)).toEqual({ applied: false, reason: "NO_PLAN" });
    expect(await buildPlacementMaskForPlan(source, plan([stairLift]))).toEqual({
      applied: false,
      reason: "NO_APPLICABLE_PLACEMENTS",
    });
    expect(await buildPlacementMaskForPlan(source, plan([bars, { ...bars, modificationCode: "RAMP", box: null }]))).toEqual({
      applied: false,
      reason: "MISSING_BOX",
    });
    expect(await buildPlacementMaskForPlan(Buffer.from("junk"), plan([bars]))).toEqual({
      applied: false,
      reason: "UNREADABLE_IMAGE",
    });
  });
});

describe("buildPlacementMaskAuditMetadata", () => {
  it("records boxes but not the mask bytes", () => {
    const boxes = [{ x: 0, y: 0, width: 1, height: 1 }];
    expect(buildPlacementMaskAuditMetadata({ applied: true, mask: Buffer.from("x"), boxes })).toEqual({
      applied: true,
      boxes,
    });
    expect(buildPlacementMaskAuditMetadata({ applied: false, reason: "NO_PLAN" })).toEqual({
      applied: false,
      reason: "NO_PLAN",
    });
  });
});
