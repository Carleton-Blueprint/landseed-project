import { describe, expect, it } from "@jest/globals";
import { PDFDocument } from "pdf-lib";
import { inflateSync } from "zlib";
import { generateGrantPdf } from "../pdf";

// pdf-lib FlateDecode-compresses page content streams and draws text as
// hex-encoded strings (`<4C616E64...> Tj`), so the drawn text never appears
// as a literal substring of the raw PDF bytes. Inflate each
// `stream ... endstream` block, then hex-decode each `<...>` show-text
// operand to recover the actual visible characters.
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

describe("generateGrantPdf", () => {
  it("returns a non-empty valid PDF buffer", async () => {
    const buffer = await generateGrantPdf({
      projectAddress: "123 Main St, Toronto, ON",
      applicantName: "Alex Carter",
      applicantEmail: "alex@example.com",
      applicantPhone: "555-0123",
      projectId: "proj-123",
      grantProgramName: "Accessibility Retrofit Program",
      estimatedFundingAmount: "$8,750",
      modificationItems: ["Ramped entry", "Main floor accessible washroom"],
      notes: "Applicant requested expedited review due to mobility needs.",
    });

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.byteLength).toBeGreaterThan(500);

    const doc = await PDFDocument.load(new Uint8Array(buffer));
    expect(doc.getPageCount()).toBeGreaterThan(0);
  });
  it("returns a PDF and renders incomplete-fields markers when required fields are missing", async () => {
    const buffer = await generateGrantPdf({
      projectAddress: "",
      applicantName: "",
      applicantEmail: "",
    } as any);

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.byteLength).toBeGreaterThan(200);

    // Decompressed page content contains the visible incomplete-field marker
    const visibleText = extractVisiblePdfText(buffer);
    expect(visibleText.includes("[Incomplete]")).toBe(true);
  });
});