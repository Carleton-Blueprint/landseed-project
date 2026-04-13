import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export interface GrantPdfInput {
  projectAddress: string;
  applicantName: string;
  applicantEmail: string;
  applicantPhone?: string;
  projectId?: string;
  grantProgramName?: string;
  estimatedFundingAmount?: string;
  preparedAtIso?: string;
  modificationItems?: string[];
  notes?: string;
}

function assertRequired(input: GrantPdfInput): void {
  const required: Array<keyof Pick<GrantPdfInput, "projectAddress" | "applicantName" | "applicantEmail">> = [
    "projectAddress",
    "applicantName",
    "applicantEmail",
  ];

  const missing = required.filter((key) => !input[key]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing required GrantPdfInput field(s): ${missing.join(", ")}`);
  }
}

function wrapText(value: string, maxCharsPerLine: number): string[] {
  if (!value.trim()) return [];

  const words = value.trim().split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
      continue;
    }

    if (current) {
      lines.push(current);
    }
    current = word;
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

export async function generateGrantPdf(input: GrantPdfInput): Promise<Buffer> {
  assertRequired(input);

  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const titleFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const bodyFont = await doc.embedFont(StandardFonts.Helvetica);

  const marginX = 56;
  let y = 742;
  const fieldGap = 26;
  const lineGap = 14;

  page.drawText("Landseed - Pre-Filled Grant Application", {
    x: marginX,
    y,
    size: 18,
    font: titleFont,
    color: rgb(0.11, 0.2, 0.37),
  });

  y -= 36;
  page.drawText("This PDF is generated from the current project intake and assessment data.", {
    x: marginX,
    y,
    size: 10,
    font: bodyFont,
    color: rgb(0.35, 0.35, 0.35),
  });

  y -= 32;
  const preparedDate = input.preparedAtIso
    ? new Date(input.preparedAtIso).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  const fields: Array<[label: string, value: string]> = [
    ["Prepared Date", preparedDate],
    ["Applicant Name", input.applicantName.trim()],
    ["Applicant Email", input.applicantEmail.trim()],
    ["Applicant Phone", input.applicantPhone?.trim() || "N/A"],
    ["Project Address", input.projectAddress.trim()],
    ["Project ID", input.projectId?.trim() || "N/A"],
    ["Grant Program", input.grantProgramName?.trim() || "N/A"],
    ["Estimated Funding", input.estimatedFundingAmount?.trim() || "N/A"],
  ];

  for (const [label, value] of fields) {
    page.drawText(`${label}:`, {
      x: marginX,
      y,
      size: 11,
      font: titleFont,
      color: rgb(0.15, 0.15, 0.15),
    });

    const wrappedValue = wrapText(value, 68);
    let valueY = y;
    for (const line of wrappedValue) {
      page.drawText(line, {
        x: marginX + 150,
        y: valueY,
        size: 11,
        font: bodyFont,
        color: rgb(0.08, 0.08, 0.08),
      });
      valueY -= lineGap;
    }

    y -= Math.max(fieldGap, wrappedValue.length * lineGap + 8);
  }

  const items = input.modificationItems?.filter((item) => item.trim().length > 0) ?? [];
  page.drawText("Modification Items:", {
    x: marginX,
    y,
    size: 11,
    font: titleFont,
    color: rgb(0.15, 0.15, 0.15),
  });

  y -= 18;
  if (items.length === 0) {
    page.drawText("- None provided", {
      x: marginX + 10,
      y,
      size: 11,
      font: bodyFont,
      color: rgb(0.08, 0.08, 0.08),
    });
    y -= fieldGap;
  } else {
    for (const item of items.slice(0, 10)) {
      const lines = wrapText(`- ${item.trim()}`, 82);
      for (const line of lines) {
        page.drawText(line, {
          x: marginX + 10,
          y,
          size: 11,
          font: bodyFont,
          color: rgb(0.08, 0.08, 0.08),
        });
        y -= lineGap;
      }
      y -= 4;
    }
  }

  const notes = input.notes?.trim();
  if (notes) {
    page.drawText("Notes:", {
      x: marginX,
      y,
      size: 11,
      font: titleFont,
      color: rgb(0.15, 0.15, 0.15),
    });

    y -= 18;
    const noteLines = wrapText(notes, 90).slice(0, 12);
    for (const line of noteLines) {
      page.drawText(line, {
        x: marginX + 10,
        y,
        size: 10,
        font: bodyFont,
        color: rgb(0.08, 0.08, 0.08),
      });
      y -= lineGap;
    }
  }

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
