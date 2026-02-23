/**
 * Grant document PDF generation (placeholder). Intended for pdf-lib: build a PDF from project and
 * applicant data. Implement generateGrantPdf when the grant template is defined.
 */
// import { PDFDocument } from "pdf-lib";

export interface GrantPdfInput {
  projectAddress: string;
  applicantName: string;
  /** Additional fields as needed */
}

export async function generateGrantPdf(input: GrantPdfInput): Promise<Buffer> {
  // Placeholder: use pdf-lib to build PDF
  void input;
  // const doc = await PDFDocument.create();
  // ...
  // return Buffer.from(await doc.save());
  return Buffer.from("");
}
