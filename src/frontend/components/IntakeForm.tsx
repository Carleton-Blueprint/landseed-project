/**
 * Digital intake form: name (required), email, and phone. Uses React Hook Form + Zod for validation.
 * Built for accessibility (labels, aria-invalid, aria-describedby, role="alert" on errors).
 * Submit handler is a placeholder; wire to your API when ready.
 */
"use client";

import React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { Button } from "@/frontend/components/ui/button";
import { signIn } from "next-auth/react";
import { PhotoUploadInterface } from "./PhotoUploadInterface";
import { useQuery, useMutation } from "@tanstack/react-query";

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

const modificationOptions = [
  "Grab bars",
  "Raised toilet",
  "Walk-in shower",
  "Widened doorway",
  "Stair lift",
  "Handrails",
] as const;

const intakeSchema = z
  .object({
    name: z.string().min(1, "Name is required").max(120, "Name is too long"),
    email: z.string().min(1, "Email is required").email("Enter a valid email"),
    phone: z
      .string()
      .min(1, "Phone is required")
      .regex(/^[\d\s\-+()]*$/, "Phone can only contain digits and + - ( )")
      .max(24, "Phone number is too long"),

    // Service address
    addressLine1: z.string().min(1, "Street address is required").max(200),
    addressLine2: z.string().max(50).optional().or(z.literal("")),
    city: z.string().min(1, "City is required").max(100),
    province: z.enum(provinces, { message: "Province is required" }),
    postalCode: z
      .string()
      .min(1, "Postal code is required")
      .max(10, "Postal code is too long")
      .regex(
        /^[A-Za-z0-9 ]+$/,
        "Postal code can only contain letters, numbers, and spaces"
      ),

    // Ownership
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

    // Caregiver section
    isCaregiver: z.boolean().default(false),
    seniorName: z.string().max(120).optional().or(z.literal("")),
    relationshipToSenior: z.string().max(120).optional().or(z.literal("")),
    caregiverConsentConfirmed: z.boolean().default(false),

    // Consent section
    clientConsentConfirmed: z.boolean().default(false),

    // Modification items
    modificationItems: z
      .array(z.string())
      .min(1, "Select at least one modification item"),
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
          message: "You must confirm your authority and the senior’s consent",
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

export type IntakeFormValues = z.infer<typeof intakeSchema>;

const defaultValues: IntakeFormValues = {
  name: "",
  email: "",
  phone: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  province: "ON",
  postalCode: "",
  ownershipStatus: "owner",
  ownershipOtherDetails: "",
  landlordName: "",
  landlordPhone: "",
  isCaregiver: false,
  seniorName: "",
  relationshipToSenior: "",
  caregiverConsentConfirmed: false,
  clientConsentConfirmed: false,
  modificationItems: [],
};

export function IntakeForm() {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<IntakeFormValues>({
    resolver: zodResolver(intakeSchema),
    defaultValues,
    mode: "onBlur",
  });

  const ownershipStatus = watch("ownershipStatus");
  const isCaregiver = watch("isCaregiver");

  // Photo upload state
  const [uploadedPhotos, setUploadedPhotos] = React.useState<File[]>([]);
  const [photoKey, setPhotoKey] = React.useState(0);
  const [draftBanner, setDraftBanner] = React.useState<string | null>(null);
  const [photoError, setPhotoError] = React.useState<string | null>(null);

  // ── Load draft on mount ────────────────────────────────────
  const { data: draftResponse } = useQuery({
    queryKey: ["intake-draft"],
    queryFn: async () => {
      const res = await fetch("/api/draft");
      if (!res.ok) return null;
      return res.json() as Promise<{
        draft: Record<string, unknown> | null;
        savedAt?: string;
      }>;
    },
    staleTime: Infinity,
    retry: false,
  });

  // Rehydrate form when draft is loaded
  React.useEffect(() => {
    if (draftResponse?.draft) {
      reset({ ...defaultValues, ...(draftResponse.draft as Partial<IntakeFormValues>) });
      const savedAt = draftResponse.savedAt
        ? new Date(draftResponse.savedAt).toLocaleString()
        : null;
      setDraftBanner(savedAt ? `Draft restored (last saved ${savedAt})` : "Draft restored");
    }
  }, [draftResponse, reset]);

  // ── Save draft mutation ────────────────────────────────────
  const [lastSaved, setLastSaved] = React.useState<string | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  const saveDraftMutation = useMutation({
    mutationFn: async (values: Partial<IntakeFormValues>) => {
      const res = await fetch("/api/draft", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) throw new Error("Failed to save draft");
      return res.json() as Promise<{ savedAt: string }>;
    },
    onSuccess: (data) => {
      setLastSaved(new Date(data.savedAt).toLocaleString());
      setSaveError(null);
    },
    onError: () => {
      setSaveError("Could not save draft. Please try again.");
    },
  });

  const handleSaveDraft = () => {
    const currentValues = watch();
    saveDraftMutation.mutate(currentValues);
  };

  const handleCancel = () => {
    reset(defaultValues);
    setUploadedPhotos([]);
    setPhotoKey((prev) => prev + 1);
    setLastSaved(null);
    setSaveError(null);
    setDraftBanner(null);
    setPhotoError(null);
  };

  async function onSubmit(values: IntakeFormValues) {
    if (uploadedPhotos.length < 1) {
      setPhotoError("Please upload at least 1 photo before submitting.");
      return;
    }

    setPhotoError(null);

    try {
      const response = await fetch("/api/intake", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(values),
      });

      if (!response.ok) {
        let errorMessage = `Request failed (${response.status})`;
        try {
          const body = await response.json();
          if (body?.error && typeof body.error === "string") {
            errorMessage = body.error;
          } else if (body && Object.keys(body).length > 0) {
            errorMessage = JSON.stringify(body);
          }
        } catch {
          /* response body wasn't JSON */
        }
        console.error("Intake error:", errorMessage);
        return;
      }

      const data = await response.json();
      console.log("User created:", data);

      const result = await signIn("credentials", {
        email: values.email,
        name: values.name,
        phone: values.phone,
        redirect: false,
      });

      if (result?.ok) {
        console.log("Signed in successfully!");
        try {
          const projectResponse = await fetch("/api/project", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              address: `${values.addressLine1}, ${values.city}, ${values.province} ${values.postalCode}`,
            }),
          });

          if (!projectResponse.ok) {
            console.error("Failed to create project");
            return;
          }

          const { project } = await projectResponse.json();
          console.log("Project created:", project.id);

          if (uploadedPhotos.length > 0) {
            for (const file of uploadedPhotos) {
              const formData = new FormData();
              formData.append("file", file);
              formData.append("projectId", project.id);

              const uploadResponse = await fetch("/api/upload", {
                method: "POST",
                body: formData,
              });

              if (uploadResponse.ok) {
                const uploadData = await uploadResponse.json();
                console.log("Photo uploaded:", uploadData.photo?.id);
              } else {
                console.error("Failed to upload photo:", file.name);
              }
            }
            console.log("All photos uploaded!");
          }

          router.push(`/submitted?projectId=${encodeURIComponent(project.id)}`);
        } catch (error) {
          console.error("Error creating project or uploading photos:", error);
        }
      }
    } catch (error) {
      console.error("Network error:", error);
    }
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      aria-label="Digital intake form"
      className="space-y-6 max-w-2xl"
    >
      <h1 className="text-xl font-semibold">Intake Form</h1>

      {/* Draft restore banner */}
      {draftBanner && (
        <div className="flex items-start justify-between gap-3 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          <span>📋 {draftBanner}</span>
          <button
            type="button"
            onClick={() => setDraftBanner(null)}
            className="shrink-0 font-medium hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-base font-semibold mb-3">Contact</h2>
        <p className="text-sm text-muted-foreground mb-3">
          Please provide your contact information.
        </p>

        <div className="flex flex-col gap-2">
          <label htmlFor="intake-name" className="mb-1 block text-sm font-medium">
            Name
          </label>
          <input
            id="intake-name"
            type="text"
            {...register("name")}
            className="rounded border border-input bg-background px-3 py-2 text-sm"
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? "intake-name-error" : undefined}
          />
          {errors.name && (
            <p id="intake-name-error" className="mt-1 text-sm text-destructive" role="alert">
              {errors.name.message}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="intake-email" className="mb-1 block text-sm font-medium">
            Email
          </label>
          <input
            id="intake-email"
            type="email"
            {...register("email")}
            className="rounded border border-input bg-background px-3 py-2 text-sm"
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? "intake-email-error" : undefined}
          />
          {errors.email && (
            <p id="intake-email-error" className="mt-1 text-sm text-destructive" role="alert">
              {errors.email.message}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="intake-phone" className="mb-1 block text-sm font-medium">
            Phone
          </label>
          <input
            id="intake-phone"
            type="tel"
            {...register("phone")}
            className="rounded border border-input bg-background px-3 py-2 text-sm"
            aria-invalid={!!errors.phone}
            aria-describedby={errors.phone ? "intake-phone-error" : undefined}
          />
          {errors.phone && (
            <p id="intake-phone-error" className="mt-1 text-sm text-destructive" role="alert">
              {errors.phone.message}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 mt-4">
          <input
            id="intake-caregiver"
            type="checkbox"
            {...register("isCaregiver")}
            className="rounded border-input"
          />
          <label htmlFor="intake-caregiver" className="text-sm">
            I am a caregiver submitting this request on behalf of a senior
          </label>
        </div>
      </section>

      {isCaregiver && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold mb-3">Caregiver</h2>
          <p className="text-sm text-muted-foreground mb-3">
            You are submitting on behalf of a senior. Please provide their details and confirm
            consent.
          </p>

          <div className="flex flex-col gap-2">
            <label htmlFor="intake-senior-name" className="mb-1 block text-sm font-medium">
              Senior name
            </label>
            <input
              id="intake-senior-name"
              type="text"
              {...register("seniorName")}
              className="rounded border border-input bg-background px-3 py-2 text-sm"
              aria-invalid={!!errors.seniorName}
              aria-describedby={errors.seniorName ? "intake-senior-name-error" : undefined}
            />
            {errors.seniorName && (
              <p
                id="intake-senior-name-error"
                className="mt-1 text-sm text-destructive"
                role="alert"
              >
                {errors.seniorName.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label
              htmlFor="intake-relationship-to-senior"
              className="mb-1 block text-sm font-medium"
            >
              Relationship to senior
            </label>
            <input
              id="intake-relationship-to-senior"
              type="text"
              {...register("relationshipToSenior")}
              className="rounded border border-input bg-background px-3 py-2 text-sm"
              aria-invalid={!!errors.relationshipToSenior}
              aria-describedby={
                errors.relationshipToSenior ? "intake-relationship-error" : undefined
              }
            />
            {errors.relationshipToSenior && (
              <p id="intake-relationship-error" className="mt-1 text-sm text-destructive" role="alert">
                {errors.relationshipToSenior.message}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <input
              id="intake-caregiver-consent"
              type="checkbox"
              {...register("caregiverConsentConfirmed")}
              className="rounded border-input"
            />
            <label htmlFor="intake-caregiver-consent" className="text-sm">
              I confirm I have authority to submit this form and the senior has consented.
            </label>
          </div>

          {errors.caregiverConsentConfirmed && (
            <p className="mt-1 text-sm text-destructive" role="alert">
              {errors.caregiverConsentConfirmed.message}
            </p>
          )}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-base font-semibold mb-3">Service address</h2>
        <p className="text-sm text-muted-foreground mb-3">
          Street address, city, province, and postal code.
        </p>

        <div className="flex flex-col gap-2">
          <label htmlFor="intake-address1" className="mb-1 block text-sm font-medium">
            Street address
          </label>
          <input
            id="intake-address1"
            type="text"
            {...register("addressLine1")}
            className="rounded border border-input bg-background px-3 py-2 text-sm"
            aria-invalid={!!errors.addressLine1}
            aria-describedby={errors.addressLine1 ? "intake-address1-error" : undefined}
          />
          {errors.addressLine1 && (
            <p id="intake-address1-error" className="mt-1 text-sm text-destructive" role="alert">
              {errors.addressLine1.message}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="intake-address2" className="mb-1 block text-sm font-medium">
            Address line 2 (optional)
          </label>
          <input
            id="intake-address2"
            type="text"
            {...register("addressLine2")}
            className="rounded border border-input bg-background px-3 py-2 text-sm"
            aria-invalid={!!errors.addressLine2}
            aria-describedby={errors.addressLine2 ? "intake-address2-error" : undefined}
          />
          {errors.addressLine2 && (
            <p id="intake-address2-error" className="mt-1 text-sm text-destructive" role="alert">
              {errors.addressLine2.message}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
          <div className="flex flex-col gap-2 flex-1">
            <label htmlFor="intake-city" className="mb-1 block text-sm font-medium">
              City
            </label>
            <input
              id="intake-city"
              type="text"
              {...register("city")}
              className="rounded border border-input bg-background px-3 py-2 text-sm"
              aria-invalid={!!errors.city}
              aria-describedby={errors.city ? "intake-city-error" : undefined}
            />
            {errors.city && (
              <p id="intake-city-error" className="mt-1 text-sm text-destructive" role="alert">
                {errors.city.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2 flex-1">
            <label htmlFor="intake-province" className="mb-1 block text-sm font-medium">
              Province
            </label>
            <select
              id="intake-province"
              {...register("province")}
              className="rounded border border-input bg-background px-3 py-2 text-sm"
              aria-invalid={!!errors.province}
              aria-describedby={errors.province ? "intake-province-error" : undefined}
            >
              {provinces.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            {errors.province && (
              <p id="intake-province-error" className="mt-1 text-sm text-destructive" role="alert">
                {errors.province.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2 w-32">
            <label htmlFor="intake-postal" className="mb-1 block text-sm font-medium">
              Postal code
            </label>
            <input
              id="intake-postal"
              type="text"
              {...register("postalCode")}
              className="rounded border border-input bg-background px-3 py-2 text-sm"
              aria-invalid={!!errors.postalCode}
              aria-describedby={errors.postalCode ? "intake-postal-error" : undefined}
            />
            {errors.postalCode && (
              <p id="intake-postal-error" className="mt-1 text-sm text-destructive" role="alert">
                {errors.postalCode.message}
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold mb-3">Ownership</h2>
        <p className="text-sm text-muted-foreground mb-3">
          Are you the owner, tenant, or something else?
        </p>

        <div className="flex flex-col gap-2">
          <label htmlFor="intake-ownership" className="mb-1 block text-sm font-medium">
            Ownership
          </label>
          <select
            id="intake-ownership"
            {...register("ownershipStatus")}
            className="rounded border border-input bg-background px-3 py-2 text-sm"
            aria-invalid={!!errors.ownershipStatus}
            aria-describedby={errors.ownershipStatus ? "intake-ownership-error" : undefined}
          >
            <option value="owner">Owner</option>
            <option value="tenant">Tenant</option>
            <option value="other">Other</option>
          </select>
          {errors.ownershipStatus && (
            <p id="intake-ownership-error" className="mt-1 text-sm text-destructive" role="alert">
              {errors.ownershipStatus.message}
            </p>
          )}
        </div>

        {ownershipStatus === "tenant" && (
          <div className="space-y-3">
            <div className="flex flex-col gap-2">
              <label htmlFor="intake-landlord-name" className="mb-1 block text-sm font-medium">
                Landlord name
              </label>
              <input
                id="intake-landlord-name"
                type="text"
                {...register("landlordName")}
                className="rounded border border-input bg-background px-3 py-2 text-sm"
                aria-invalid={!!errors.landlordName}
                aria-describedby={errors.landlordName ? "intake-landlord-name-error" : undefined}
              />
              {errors.landlordName && (
                <p
                  id="intake-landlord-name-error"
                  className="mt-1 text-sm text-destructive"
                  role="alert"
                >
                  {errors.landlordName.message}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="intake-landlord-phone" className="mb-1 block text-sm font-medium">
                Landlord phone
              </label>
              <input
                id="intake-landlord-phone"
                type="tel"
                {...register("landlordPhone")}
                className="rounded border border-input bg-background px-3 py-2 text-sm"
                aria-invalid={!!errors.landlordPhone}
                aria-describedby={
                  errors.landlordPhone ? "intake-landlord-phone-error" : undefined
                }
              />
              {errors.landlordPhone && (
                <p
                  id="intake-landlord-phone-error"
                  className="mt-1 text-sm text-destructive"
                  role="alert"
                >
                  {errors.landlordPhone.message}
                </p>
              )}
            </div>
          </div>
        )}

        {ownershipStatus === "other" && (
          <div className="flex flex-col gap-2">
            <label htmlFor="intake-ownership-other" className="mb-1 block text-sm font-medium">
              Explain your ownership status
            </label>
            <input
              id="intake-ownership-other"
              type="text"
              {...register("ownershipOtherDetails")}
              className="rounded border border-input bg-background px-3 py-2 text-sm"
              aria-invalid={!!errors.ownershipOtherDetails}
              aria-describedby={
                errors.ownershipOtherDetails ? "intake-ownership-other-error" : undefined
              }
            />
            {errors.ownershipOtherDetails && (
              <p
                id="intake-ownership-other-error"
                className="mt-1 text-sm text-destructive"
                role="alert"
              >
                {errors.ownershipOtherDetails.message}
              </p>
            )}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold mb-3">Modification items</h2>
        <p className="text-sm text-muted-foreground mb-3">
          Select all modifications needed for this request.
        </p>

        <div className="grid gap-2 sm:grid-cols-2">
          {modificationOptions.map((item) => (
            <label
              key={item}
              className="flex items-center gap-2 rounded border border-input px-3 py-2 text-sm"
            >
              <input
                type="checkbox"
                value={item}
                {...register("modificationItems")}
                className="rounded border-input"
              />
              <span>{item}</span>
            </label>
          ))}
        </div>

        {errors.modificationItems && (
          <p className="mt-1 text-sm text-destructive" role="alert">
            {errors.modificationItems.message}
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold mb-3">Photos</h2>
        <p className="text-sm text-muted-foreground mb-3">
          Upload between 1 and 10 photos of the space requiring modification. Accepted file types:
          JPG, JPEG, PNG, and HEIC. Maximum file size: 10MB per photo.
        </p>

        <PhotoUploadInterface
          key={photoKey}
          onUpload={(files) => {
            setUploadedPhotos(files);
            if (files.length > 0) {
              setPhotoError(null);
            }
          }}
          maxFiles={10}
          maxSizeMB={10}
        />

        {photoError && (
          <p className="text-sm text-destructive" role="alert">
            {photoError}
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold mb-3">Consent</h2>
        <div className="rounded-md border border-input bg-muted/30 p-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            We collect your contact details, address, photos, and other information in this form so
            we can review your modification request, prepare estimates, and support your project.
          </p>
          <p className="text-sm text-muted-foreground">
            Your information will be stored securely and only used for processing your request and
            related project support.
          </p>

          <div className="flex items-start gap-2 pt-1">
            <input
              id="intake-client-consent"
              type="checkbox"
              {...register("clientConsentConfirmed")}
              className="mt-1 rounded border-input"
              aria-invalid={!!errors.clientConsentConfirmed}
              aria-describedby={
                errors.clientConsentConfirmed ? "intake-client-consent-error" : undefined
              }
            />
            <label htmlFor="intake-client-consent" className="text-sm leading-6">
              I consent to the collection, storage, and processing of my photos and personal
              information for the purpose of reviewing and managing my request.
            </label>
          </div>

          {errors.clientConsentConfirmed && (
            <p
              id="intake-client-consent-error"
              className="mt-1 text-sm text-destructive"
              role="alert"
            >
              {errors.clientConsentConfirmed.message}
            </p>
          )}
        </div>
      </section>

      {/* Draft save status */}
      {lastSaved && (
        <p className="text-sm text-green-700" role="status">
          ✓ Draft saved at {lastSaved}
        </p>
      )}

      {saveError && (
        <p className="text-sm text-destructive" role="alert">
          {saveError}
        </p>
      )}

      <div className="flex gap-4 mt-2">
        <Button type="button" variant="outline" onClick={handleCancel} disabled={isSubmitting}>
          Cancel
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={handleSaveDraft}
          disabled={isSubmitting || saveDraftMutation.isPending}
        >
          {saveDraftMutation.isPending ? "Saving…" : "Save as Draft"}
        </Button>

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Submitting…" : "Submit"}
        </Button>
      </div>
    </form>
  );
}