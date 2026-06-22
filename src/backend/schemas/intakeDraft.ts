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
