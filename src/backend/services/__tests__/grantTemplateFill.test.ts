import { describe, expect, it } from "@jest/globals";
import { inflateSync } from "zlib";
import { fillGrantTemplate } from "../grantTemplateFill";
import type { AssembledGrantPdfInput } from "../grantPdfAssembler";

// Mirrors pdf.test.ts's approach: pdf-lib FlateDecode-compresses streams and
// hex-encodes drawn/field text, so inflate each stream and hex-decode the
// show-text operands to recover the actual visible characters.
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

const baseInput: AssembledGrantPdfInput = {
  applicantName: "Sam Applicant",
  applicantEmail: "sam@example.com",
  applicantPhone: "555-1234",
  projectAddress: "123 Main St",
  projectId: "proj-1",
  grantProgramName: "Home Accessibility Grant",
  modificationItems: ["Ramp installation", "Grab bars"],
  estimatedCost: "$1,000 – $2,000",
  ownershipStatus: "Owner",
  incompleteFields: [],
  preparedAtIso: "2026-07-08T12:00:00.000Z",
};

describe("fillGrantTemplate", () => {
  it("returns a valid, non-empty PDF buffer", async () => {
    const buffer = await fillGrantTemplate(baseInput);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.byteLength).toBeGreaterThan(500);
  });

  it("fills every assembled field into the template", async () => {
    const buffer = await fillGrantTemplate(baseInput);
    const text = extractVisiblePdfText(buffer);

    expect(text).toContain("Sam Applicant");
    expect(text).toContain("sam@example.com");
    expect(text).toContain("555-1234");
    expect(text).toContain("123 Main St");
    expect(text).toContain("Owner");
    expect(text).toContain("Home Accessibility Grant");
    expect(text).toContain("Ramp installation, Grab bars");
    expect(text).toContain("$1,000");
    expect(text).toContain("proj-1");
    expect(text).toContain("2026-07-08");
  });

  it("renders incomplete fields and never throws on missing data", async () => {
    const buffer = await fillGrantTemplate({
      ...baseInput,
      applicantPhone: null,
      estimatedCost: null,
      incompleteFields: ["client phone", "estimated cost"],
    });

    const text = extractVisiblePdfText(buffer);
    expect(text).toContain("client phone, estimated cost");
  });

  it("shows a placeholder when there are no modification items", async () => {
    const buffer = await fillGrantTemplate({ ...baseInput, modificationItems: [] });
    const text = extractVisiblePdfText(buffer);
    expect(text).toContain("None provided");
  });
});
