import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import type { AssembledGrantMatchSummaryInput, AssembledMatchedGrant } from './grantMatchSummaryAssembler';
import type { AiOutputSource } from '@/backend/audit/aiProvenance';

const PAGE_SIZE: [number, number] = [612, 792];
const MARGIN_X = 56;
const TOP_Y = 742;
const BOTTOM_Y = 72;

function wrapText(value: string, maxCharsPerLine: number): string[] {
  if (!value.trim()) return [];

  const words = value.trim().split(/\s+/);
  const lines: string[] = [];
  let current = '';

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

function outputSourceLabel(outputSource: AiOutputSource): string {
  switch (outputSource) {
    case 'LIVE':
      return 'AI-Assisted (live grant discovery)';
    case 'HEURISTIC':
      return 'Heuristic Scoring (catalog-based)';
    case 'MOCK':
      return 'AI-Assisted (mock/test mode)';
    case 'NONE':
    default:
      return 'Not available';
  }
}

/** Tracks the current page/cursor across a document that may span multiple pages. */
class SummaryPdfCursor {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  titleFont: PDFFont;
  bodyFont: PDFFont;

  constructor(doc: PDFDocument, page: PDFPage, titleFont: PDFFont, bodyFont: PDFFont) {
    this.doc = doc;
    this.page = page;
    this.y = TOP_Y;
    this.titleFont = titleFont;
    this.bodyFont = bodyFont;
  }

  /** Starts a new page and resets the cursor when the given height won't fit above BOTTOM_Y. */
  ensureSpace(height: number): void {
    if (this.y - height < BOTTOM_Y) {
      this.page = this.doc.addPage(PAGE_SIZE);
      this.y = TOP_Y;
    }
  }

  drawLine(text: string, opts: { size: number; font: PDFFont; color: ReturnType<typeof rgb>; x?: number }): void {
    this.ensureSpace(opts.size + 4);
    this.page.drawText(text, {
      x: opts.x ?? MARGIN_X,
      y: this.y,
      size: opts.size,
      font: opts.font,
      color: opts.color,
    });
    this.y -= opts.size + 6;
  }

  drawWrapped(text: string, maxCharsPerLine: number, opts: { size: number; font: PDFFont; color: ReturnType<typeof rgb>; x?: number }): void {
    const lines = wrapText(text, maxCharsPerLine);
    for (const line of lines) {
      this.drawLine(line, opts);
    }
  }
}

function drawHeaderField(cursor: SummaryPdfCursor, label: string, value: string): void {
  cursor.ensureSpace(16);
  cursor.page.drawText(`${label}:`, {
    x: MARGIN_X,
    y: cursor.y,
    size: 11,
    font: cursor.titleFont,
    color: rgb(0.15, 0.15, 0.15),
  });
  const wrapped = wrapText(value, 68);
  let valueY = cursor.y;
  for (const line of wrapped) {
    cursor.page.drawText(line, {
      x: MARGIN_X + 150,
      y: valueY,
      size: 11,
      font: cursor.bodyFont,
      color: rgb(0.08, 0.08, 0.08),
    });
    valueY -= 14;
  }
  cursor.y -= Math.max(22, wrapped.length * 14 + 8);
}

function drawMatchedGrant(cursor: SummaryPdfCursor, grant: AssembledMatchedGrant, index: number): void {
  // Reserve enough room for the program name + two detail lines before starting the block,
  // so a grant's header never gets orphaned alone at the bottom of a page.
  cursor.ensureSpace(70);

  cursor.drawLine(`${index + 1}. ${grant.programName}`, {
    size: 13,
    font: cursor.titleFont,
    color: rgb(0.11, 0.2, 0.37),
  });

  cursor.drawLine(
    `Eligibility: ${grant.eligibilityStatus}   |   Confidence: ${grant.confidence}   |   Estimated Funding: ${
      grant.estimatedFunding ?? 'Not specified'
    }`,
    { size: 10, font: cursor.bodyFont, color: rgb(0.3, 0.3, 0.3), x: MARGIN_X + 12 }
  );

  cursor.drawWrapped(grant.scopeDescription, 88, {
    size: 10,
    font: cursor.bodyFont,
    color: rgb(0.08, 0.08, 0.08),
    x: MARGIN_X + 12,
  });

  cursor.y -= 10;
}

export async function generateGrantMatchSummaryPdf(input: AssembledGrantMatchSummaryInput): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage(PAGE_SIZE);
  const titleFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const bodyFont = await doc.embedFont(StandardFonts.Helvetica);

  const cursor = new SummaryPdfCursor(doc, page, titleFont, bodyFont);

  cursor.drawLine('Landseed - Grant Match Summary', {
    size: 18,
    font: titleFont,
    color: rgb(0.11, 0.2, 0.37),
  });
  cursor.y -= 8;
  cursor.drawLine(
    'Summary of all grant programs evaluated during eligibility assessment for this project.',
    { size: 10, font: bodyFont, color: rgb(0.35, 0.35, 0.35) }
  );
  cursor.y -= 16;

  const assessmentDateDisplay = new Date(input.assessmentDate).toISOString().slice(0, 10);

  drawHeaderField(cursor, 'Client Name', input.clientName);
  drawHeaderField(cursor, 'Project Address', input.projectAddress);
  drawHeaderField(cursor, 'Modification Type', input.modificationType);
  drawHeaderField(cursor, 'Assessment Date', assessmentDateDisplay);
  drawHeaderField(cursor, 'Assessment Method', outputSourceLabel(input.outputSource));

  cursor.y -= 10;
  cursor.drawLine(
    input.hasMatches ? `Matched Grant Programs (${input.matchedGrants.length})` : 'Matched Grant Programs',
    { size: 13, font: titleFont, color: rgb(0.15, 0.15, 0.15) }
  );
  cursor.y -= 6;

  if (!input.hasMatches) {
    cursor.drawLine('No matching grants found for this assessment.', {
      size: 11,
      font: bodyFont,
      color: rgb(0.4, 0.4, 0.4),
      x: MARGIN_X + 12,
    });
  } else {
    input.matchedGrants.forEach((grant, index) => drawMatchedGrant(cursor, grant, index));
  }

  if (input.incompleteFields.length > 0) {
    cursor.y -= 12;
    cursor.drawLine('Incomplete Fields:', { size: 11, font: titleFont, color: rgb(0.6, 0.1, 0.1) });
    cursor.drawWrapped(input.incompleteFields.join(', '), 90, {
      size: 10,
      font: bodyFont,
      color: rgb(0.5, 0.1, 0.1),
      x: MARGIN_X + 10,
    });
  }

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
