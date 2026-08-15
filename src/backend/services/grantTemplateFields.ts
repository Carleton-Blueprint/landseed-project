// Field names on the fillable AcroForm template at
// assets/grant-templates/grant-application-template.pdf. Shared between the
// template generator (scripts/generate-grant-template.ts) and the filler
// (grantTemplateFill.ts) so the two never drift out of sync.
export const GRANT_TEMPLATE_FIELD_NAMES = {
  preparedDate: "prepared_date",
  applicantName: "applicant_name",
  applicantEmail: "applicant_email",
  applicantPhone: "applicant_phone",
  projectAddress: "project_address",
  ownershipStatus: "ownership_status",
  grantProgramName: "grant_program_name",
  modificationItems: "modification_items",
  estimatedCost: "estimated_cost",
  projectId: "project_id",
  incompleteFields: "incomplete_fields",
} as const;
