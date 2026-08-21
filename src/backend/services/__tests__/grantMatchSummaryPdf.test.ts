import { describe, expect, it } from "@jest/globals";
import { PDFDocument } from "pdf-lib";
import { inflateSync } from "zlib";
import { generateGrantMatchSummaryPdf } from "../grantMatchSummaryPdf";
import type { AssembledGrantMatchSummaryInput } from "../grantMatchSummaryAssembler";

// See pdf.test.ts for why this decode step is necessary: pdf-lib
// FlateDecode-compresses page content streams and draws text as
// hex-encoded show-text operands, so drawn text never appears as a
// literal substring of the raw PDF bytes.
function extractVisiblePdfText(buffer: Buffer): string {
  const raw = buffer.toString("latin1");
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  const hexStringRegex = /<([0-9A-Fa-f]+)>/g;
  let decoded = "";
  let streamMatch: RegExpExecArray | null;

  while ((streamMatch = streamRegex.exec(raw)) !== null) {
    const streamBytes = Buffer.from(streamMatch[1], "latin1");
    let content: string;
    try {
      content = inflateSync(streamBytes).toString("latin1");
    } catch {
      content = streamBytes.toString("latin1");
    }

    let hexMatch: RegExpExecArray | null;
    while ((hexMatch = hexStringRegex.exec(content)) !== null) {
      decoded += Buffer.from(hexMatch[1], "hex").toString("latin1");
    }
  }

  return decoded;
}

function baseInput(overrides: Partial<AssembledGrantMatchSummaryInput> = {}): AssembledGrantMatchSummaryInput {
  return {
    projectId: "proj-1",
    eligibilityAssessmentId: "assess-1",
    clientName: "Sam Applicant",
    projectAddress: "123 Main St, Toronto, ON",
    modificationType: "Grab Bars, Widened Doorway",
    assessmentDate: "2026-08-20T12:00:00.000Z",
    outputSource: "LIVE",
    matchedGrants: [],
    hasMatches: false,
    incompleteFields: [],
    preparedAtIso: new Date().toISOString(),
    ...overrides,
  };
}

describe("generateGrantMatchSummaryPdf", () => {
  it("returns a valid single-page PDF and renders the no-matches message when there are no matched grants", async () => {
    const buffer = await generateGrantMatchSummaryPdf(baseInput());

    expect(Buffer.isBuffer(buffer)).toBe(true);

    const doc = await PDFDocument.load(new Uint8Array(buffer));
    expect(doc.getPageCount()).toBe(1);

    const visibleText = extractVisiblePdfText(buffer);
    expect(visibleText).toContain("No matching grants found for this assessment.");
    expect(visibleText).toContain("Sam Applicant");
    expect(visibleText).toContain("123 Main St, Toronto, ON");
  });

  it("renders each matched grant's program name, confidence, and estimated funding", async () => {
    const buffer = await generateGrantMatchSummaryPdf(
      baseInput({
        hasMatches: true,
        matchedGrants: [
          {
            programName: "Home Accessibility Tax Credit",
            eligibilityStatus: "ELIGIBLE",
            confidence: "HIGH",
            estimatedFunding: "Up to $20,000",
            scopeDescription: "Federal tax credit for eligible accessibility renovations.",
          },
          {
            programName: "Ontario Renovates",
            eligibilityStatus: "ELIGIBLE",
            confidence: "MEDIUM",
            estimatedFunding: null,
            scopeDescription: "Provincial forgivable loan program.",
          },
        ],
      })
    );

    const visibleText = extractVisiblePdfText(buffer);
    expect(visibleText).toContain("Home Accessibility Tax Credit");
    expect(visibleText).toContain("Up to $20,000");
    expect(visibleText).toContain("Ontario Renovates");
    expect(visibleText).toContain("Not specified");
    expect(visibleText).not.toContain("No matching grants found");
  });

  it("paginates onto additional pages when there are many matched grants", async () => {
    const matchedGrants = Array.from({ length: 25 }, (_, i) => ({
      programName: `Grant Program ${i + 1}`,
      eligibilityStatus: "ELIGIBLE" as const,
      confidence: "HIGH" as const,
      estimatedFunding: "Up to $10,000",
      scopeDescription:
        "A lengthy scope description used to force page overflow across the generated summary document for pagination testing purposes.",
    }));

    const buffer = await generateGrantMatchSummaryPdf(baseInput({ hasMatches: true, matchedGrants }));

    const doc = await PDFDocument.load(new Uint8Array(buffer));
    expect(doc.getPageCount()).toBeGreaterThan(1);

    const visibleText = extractVisiblePdfText(buffer);
    expect(visibleText).toContain("Grant Program 1");
    expect(visibleText).toContain("Grant Program 25");
  });

  it("renders incomplete field markers when present", async () => {
    const buffer = await generateGrantMatchSummaryPdf(
      baseInput({ clientName: "[Incomplete]", incompleteFields: ["client name", "project address"] })
    );

    const visibleText = extractVisiblePdfText(buffer);
    expect(visibleText).toContain("Incomplete Fields:");
    expect(visibleText).toContain("client name");
  });
});
