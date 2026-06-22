import { z } from "zod";

export const guidedDataSchema = z.object({
  mobilityAssistance: z.enum(["yes", "no"]).optional(),
  safetyFeatures: z.array(z.string()).optional(),
  bathroomModifications: z.enum(["yes", "no", "not sure"]).optional(),
  urgency: z.enum(["immediate", "soon", "planning", "just exploring"]).optional(),
  additionalDetails: z.string().max(500).optional(),
});

export const intakeDataSchema = z.object({
  name: z.string().max(120).optional().default(""),
  email: z.string().max(254).optional().default(""),
  phone: z.string().max(24).optional().default(""),
  addressLine1: z.string().max(200).optional().default(""),
  addressLine2: z.string().max(50).optional().default(""),
  city: z.string().max(100).optional().default(""),
  province: z.string().max(5).optional().default("ON"),
  postalCode: z.string().max(10).optional().default(""),
  ownershipStatus: z.enum(["owner", "tenant", "other"]).optional().default("owner"),
  ownershipOtherDetails: z.string().max(200).optional().default(""),
  landlordName: z.string().max(120).optional().default(""),
  landlordPhone: z.string().max(24).optional().default(""),
  isCaregiver: z.boolean().optional().default(false),
  seniorName: z.string().max(120).optional().default(""),
  relationshipToSenior: z.string().max(120).optional().default(""),
  caregiverConsentConfirmed: z.boolean().optional().default(false),
  clientConsentConfirmed: z.boolean().optional().default(false),
  modificationItems: z.array(z.string()).optional().default([]),
});

export const patchIntakeDraftSchema = z
  .object({
    guidedData: guidedDataSchema.optional(),
    intakeData: intakeDataSchema.optional(),
  })
  .refine((data) => data.guidedData !== undefined || data.intakeData !== undefined, {
    message: "At least one of guidedData or intakeData is required",
  });

export type GuidedData = z.infer<typeof guidedDataSchema>;
export type IntakeData = z.infer<typeof intakeDataSchema>;
export type PatchIntakeDraftInput = z.infer<typeof patchIntakeDraftSchema>;

const provinces = [
  "AB",
  "BC",
  "MB",
  "NB",
  "NL",
  "NS",
  "NT",
  "NU",
  "ON",
  "PE",
  "QC",
  "SK",
  "YT",
] as const;

/** Full intake validation used when promoting a draft to a submitted project. */
export const promoteIntakeDataSchema = z
  .object({
    name: z.string().min(1, "Name is required").max(120, "Name is too long"),
    email: z.string().min(1, "Email is required").email("Enter a valid email"),
    phone: z
      .string()
      .min(1, "Phone is required")
      .regex(/^[\d\s\-+()]*$/, "Phone can only contain digits and + - ( )")
      .max(24, "Phone number is too long"),
    addressLine1: z.string().min(1, "Street address is required").max(200),
    addressLine2: z.string().max(50).optional().or(z.literal("")),
    city: z.string().min(1, "City is required").max(100),
    province: z.enum(provinces, { message: "Province is required" }),
    postalCode: z
      .string()
      .min(1, "Postal code is required")
      .max(10, "Postal code is too long")
      .regex(/^[A-Za-z0-9 ]+$/, "Postal code can only contain letters, numbers, and spaces"),
    ownershipStatus: z.enum(["owner", "tenant", "other"], {
      message: "Please select owner, tenant, or other",
    }),
    ownershipOtherDetails: z.string().max(200).optional().or(z.literal("")),
    landlordName: z.string().max(120).optional().or(z.literal("")),
    landlordPhone: z
      .string()
      .regex(/^[\d\s\-+()]*$/, "Phone can only contain digits and + - ( )")
      .max(24, "Phone number is too long")
      .optional()
      .or(z.literal("")),
    isCaregiver: z.boolean().default(false),
    seniorName: z.string().max(120).optional().or(z.literal("")),
    relationshipToSenior: z.string().max(120).optional().or(z.literal("")),
    caregiverConsentConfirmed: z.boolean().default(false),
    clientConsentConfirmed: z.boolean().default(false),
    modificationItems: z.array(z.string()).min(1, "Select at least one modification item"),
  })
  .superRefine((data, ctx) => {
    if (data.ownershipStatus === "tenant") {
      if (!data.landlordName?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["landlordName"],
          message: "Landlord name is required for tenants",
        });
      }
      if (!data.landlordPhone?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["landlordPhone"],
          message: "Landlord phone is required for tenants",
        });
      }
    }
    if (data.ownershipStatus === "other") {
      if (!data.ownershipOtherDetails?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ownershipOtherDetails"],
          message: "Please explain your ownership status",
        });
      }
    }
    if (data.isCaregiver) {
      if (!data.seniorName?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["seniorName"],
          message: "Senior name is required when submitting as a caregiver",
        });
      }
      if (!data.relationshipToSenior?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["relationshipToSenior"],
          message: "Relationship to the senior is required",
        });
      }
      if (data.caregiverConsentConfirmed !== true) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["caregiverConsentConfirmed"],
          message: "You must confirm your authority and the senior's consent",
        });
      }
    }
    if (data.clientConsentConfirmed !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["clientConsentConfirmed"],
        message: "You must consent before submitting this request",
      });
    }
  });

export type PromoteIntakeData = z.infer<typeof promoteIntakeDataSchema>;
