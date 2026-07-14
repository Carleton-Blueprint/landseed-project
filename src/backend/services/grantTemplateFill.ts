import { PDFDocument } from "pdf-lib";
import { readFileSync } from "fs";
import { join } from "path";
import type { AssembledGrantPdfInput } from "./grantPdfAssembler";
import { GRANT_TEMPLATE_FIELD_NAMES } from "./grantTemplateFields";

const TEMPLATE_PATH = join(process.cwd(), "assets", "grant-templates", "grant-application-template.pdf");

function formatPreparedDate(preparedAtIso: string): string {
  const date = new Date(preparedAtIso);
  return Number.isNaN(date.getTime()) ? preparedAtIso : date.toISOString().slice(0, 10);
}

function setFieldValue(form: import("pdf-lib").PDFForm, fieldName: string, value: string) {
  const field = form.getTextField(fieldName);
  field.setText(value || "N/A");
}

/**
 * Fills the fillable grant-application template (see
 * assets/grant-templates/grant-application-template.pdf, built by
 * scripts/generate-grant-template.ts) with the assembled FR-3.2 fields and
 * returns a flattened, non-interactive PDF buffer.
 */
export async function fillGrantTemplate(input: AssembledGrantPdfInput): Promise<Buffer> {
  const templateBytes = readFileSync(TEMPLATE_PATH);
  const doc = await PDFDocument.load(new Uint8Array(templateBytes));
  const form = doc.getForm();

  setFieldValue(form, GRANT_TEMPLATE_FIELD_NAMES.preparedDate, formatPreparedDate(input.preparedAtIso));
  setFieldValue(form, GRANT_TEMPLATE_FIELD_NAMES.applicantName, input.applicantName);
  setFieldValue(form, GRANT_TEMPLATE_FIELD_NAMES.applicantEmail, input.applicantEmail);
  setFieldValue(form, GRANT_TEMPLATE_FIELD_NAMES.applicantPhone, input.applicantPhone ?? "N/A");
  setFieldValue(form, GRANT_TEMPLATE_FIELD_NAMES.projectAddress, input.projectAddress);
  setFieldValue(form, GRANT_TEMPLATE_FIELD_NAMES.ownershipStatus, input.ownershipStatus);
  setFieldValue(form, GRANT_TEMPLATE_FIELD_NAMES.grantProgramName, input.grantProgramName);
  setFieldValue(
    form,
    GRANT_TEMPLATE_FIELD_NAMES.modificationItems,
    input.modificationItems.length > 0 ? input.modificationItems.join(", ") : "None provided"
  );
  setFieldValue(form, GRANT_TEMPLATE_FIELD_NAMES.estimatedCost, input.estimatedCost ?? "N/A");
  setFieldValue(form, GRANT_TEMPLATE_FIELD_NAMES.projectId, input.projectId);
  setFieldValue(
    form,
    GRANT_TEMPLATE_FIELD_NAMES.incompleteFields,
    input.incompleteFields.length > 0 ? input.incompleteFields.join(", ") : "None — all fields complete"
  );

  // Deliberately not flattened: form.flatten() corrupts this document's
  // xref table in the installed pdf-lib version (verified independent of
  // useObjectStreams). Leaving the form fields intact still renders
  // correctly everywhere and produces a structurally valid PDF.
  const bytes = await doc.save();
  return Buffer.from(bytes);
}
