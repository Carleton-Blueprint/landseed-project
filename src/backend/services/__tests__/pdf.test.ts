import { describe, expect, it } from "@jest/globals";
import { PDFDocument } from "pdf-lib";
import { generateGrantPdf } from "../pdf";

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

  it("throws when required fields are missing", async () => {
    await expect(
      generateGrantPdf({
        projectAddress: "",
        applicantName: "",
        applicantEmail: "",
      })
    ).rejects.toThrow("Missing required GrantPdfInput field(s)");
  });
});