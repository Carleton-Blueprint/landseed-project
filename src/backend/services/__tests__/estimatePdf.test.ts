import { describe, expect, it } from "@jest/globals";
import { PDFDocument, PDFRawStream } from "pdf-lib";
import { inflateSync } from "zlib";
import { generateEstimatePdf } from "../estimatePdf";
import type { AssembledEstimateInput } from "../estimateAssembler";

// pdf-lib FlateDecode-compresses page content streams and draws text as
// hex-encoded show-text operands, so drawn text never appears as a literal
// substring of the raw PDF bytes. Unlike a raw-bytes regex scan for
// "stream...endstream" (fragile: compressed binary content can coincidentally
// contain the literal "endstream" bytes and truncate the match), this walks
// pdf-lib's already-parsed indirect objects, so each stream's bounds come
// from the parser rather than a text-boundary guess.
async function extractVisiblePdfText(buffer: Buffer): Promise<string> {
  const doc = await PDFDocument.load(new Uint8Array(buffer));
  const hexStringRegex = /<([0-9A-Fa-f]+)>/g;
  let decoded = "";

  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;

    const rawBytes = Buffer.from(obj.getContents());
    let content: string;
    try {
      content = inflateSync(rawBytes).toString("latin1");
    } catch {
      content = rawBytes.toString("latin1");
    }

    let hexMatch: RegExpExecArray | null;
    while ((hexMatch = hexStringRegex.exec(content)) !== null) {
      decoded += Buffer.from(hexMatch[1], "hex").toString("latin1");
    }
  }

  return decoded;
}

function baseInput(overrides: Partial<AssembledEstimateInput> = {}): AssembledEstimateInput {
  return {
    projectId: "proj-1",
    quoteId: "quote-1",
    clientName: "Sam Applicant",
    projectAddress: "123 Main St, Toronto, ON",
    modificationType: "Grab Bars, Widened Doorway",
    selectedTier: null,
    pricing: {
      selectedTier: null,
      lineItems: [],
      subtotal: 0,
      laborTotal: 0,
      markupTotal: 0,
      total: 0,
      estimateMin: 0,
      estimateMax: 0,
    },
    incompleteFields: [],
    preparedAtIso: new Date().toISOString(),
    wasOverridden: false,
    ...overrides,
  };
}

describe("generateEstimatePdf", () => {
  it("returns a valid single-page PDF and renders the no-line-items message when empty", async () => {
    const buffer = await generateEstimatePdf(baseInput());

    expect(Buffer.isBuffer(buffer)).toBe(true);

    const doc = await PDFDocument.load(new Uint8Array(buffer));
    expect(doc.getPageCount()).toBe(1);

    const visibleText = await extractVisiblePdfText(buffer);
    expect(visibleText).toContain("No itemized line items available for this estimate.");
    expect(visibleText).toContain("Sam Applicant");
    expect(visibleText).toContain("123 Main St, Toronto, ON");
  });

  it("renders each line item's description, quantity, and cost breakdown", async () => {
    const buffer = await generateEstimatePdf(
      baseInput({
        selectedTier: "premium",
        pricing: {
          selectedTier: "premium",
          lineItems: [
            {
              description: "Grab bar install",
              quantity: 2,
              pricingQuery: "grab bar",
              materialUnitCost: 40,
              materialTotal: 80,
              laborHours: 3,
              laborRate: 90,
              laborTotal: 270,
              markupPercentage: 0,
              markupTotal: 0,
              lineTotal: 350,
            },
            {
              description: "Widened doorway",
              quantity: 1,
              pricingQuery: "widen doorway",
              materialUnitCost: 600,
              materialTotal: 600,
              laborHours: 6,
              laborRate: 110,
              laborTotal: 660,
              markupPercentage: 0,
              markupTotal: 0,
              lineTotal: 1260,
            },
          ],
          subtotal: 1610,
          laborTotal: 930,
          markupTotal: 0,
          total: 1610,
          estimateMin: 1529.5,
          estimateMax: 1690.5,
        },
      })
    );

    const visibleText = await extractVisiblePdfText(buffer);
    expect(visibleText).toContain("Grab bar install");
    expect(visibleText).toContain("Widened doorway");
    expect(visibleText).toContain("Premium");
    expect(visibleText).toContain("$1610.00");
    expect(visibleText).not.toContain("No itemized line items");
  });

  it("paginates onto additional pages when there are many line items", async () => {
    const lineItems = Array.from({ length: 30 }, (_, i) => ({
      description: `Line item ${i + 1}`,
      quantity: 1,
      pricingQuery: "item",
      materialUnitCost: 100,
      materialTotal: 100,
      laborHours: 1,
      laborRate: 90,
      laborTotal: 90,
      markupPercentage: 0,
      markupTotal: 0,
      lineTotal: 190,
    }));

    const buffer = await generateEstimatePdf(
      baseInput({
        pricing: {
          selectedTier: null,
          lineItems,
          subtotal: 5700,
          laborTotal: 2700,
          markupTotal: 0,
          total: 5700,
          estimateMin: 5415,
          estimateMax: 5985,
        },
      })
    );

    const doc = await PDFDocument.load(new Uint8Array(buffer));
    expect(doc.getPageCount()).toBeGreaterThan(1);

    const visibleText = await extractVisiblePdfText(buffer);
    expect(visibleText).toContain("Line item 1");
    expect(visibleText).toContain("Line item 30");
  });

  it("renders incomplete field markers when present", async () => {
    const buffer = await generateEstimatePdf(
      baseInput({ clientName: "[Incomplete]", incompleteFields: ["client name", "project address"] })
    );

    const visibleText = await extractVisiblePdfText(buffer);
    expect(visibleText).toContain("Incomplete Fields:");
    expect(visibleText).toContain("client name");
  });

  it("omits Markup Total and Estimate Range, and shows the override note, once overridden", async () => {
    const buffer = await generateEstimatePdf(
      baseInput({
        wasOverridden: true,
        pricing: {
          selectedTier: null,
          lineItems: [
            {
              description: "Grab bar install",
              quantity: 2,
              pricingQuery: "Grab bar install",
              materialUnitCost: 40,
              materialTotal: 80,
              laborHours: 0,
              laborRate: 0,
              laborTotal: 270,
              markupPercentage: 0,
              markupTotal: 0,
              lineTotal: 350,
            },
          ],
          subtotal: 350,
          laborTotal: 270,
          markupTotal: 0,
          total: 400,
          estimateMin: 400,
          estimateMax: 400,
        },
      })
    );

    const visibleText = await extractVisiblePdfText(buffer);
    expect(visibleText).toContain("Subtotal");
    expect(visibleText).toContain("Labor Total");
    expect(visibleText).toContain("$400.00");
    expect(visibleText).toContain("This estimate was manually adjusted by our advisory team.");
    expect(visibleText).not.toContain("Markup Total");
    expect(visibleText).not.toContain("Estimate Range");
  });
});
