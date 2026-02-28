/**
 * Digital intake form: name (required), email, and phone. Uses React Hook Form + Zod for validation.
 * Built for accessibility (labels, aria-invalid, aria-describedby, role="alert" on errors).
 * Submit handler is a placeholder; wire to your API when ready.
 */
"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/frontend/components/ui/button";
import { Input } from "@/frontend/components/ui/input";
const provinces = ["AB","BC","MB","NB","NL","NS","NT","NU","ON","PE","QC","SK","YT",] as const;

const intakeSchema = z.object({
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
      .regex(/^[A-Za-z0-9 ]+$/, "Postal code can only contain letters, numbers, and spaces"),

    // Ownership
    ownershipStatus: z.enum(["owner", "tenant", "other"], { message: "Please select owner, tenant, or other" }),
    ownershipOtherDetails: z.string().max(200).optional().or(z.literal("")),
    landlordName: z.string().max(120).optional().or(z.literal("")),
    landlordPhone: z
      .string()
      .regex(/^[\d\s\-+()]*$/, "Phone can only contain digits and + - ( )")
      .max(24, "Phone number is too long")
      .optional()
      .or(z.literal("")),
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
};

export function IntakeForm() {
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<IntakeFormValues>({
    resolver: zodResolver(intakeSchema),
    defaultValues,
    mode: "onBlur",
  });

  const ownershipStatus = watch("ownershipStatus");

  function onSubmit(values: IntakeFormValues) {
    // Small job: submit to API when ready
    console.log("Intake submitted", values);
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-6"
      noValidate
      aria-label="Digital intake form"
    >
      {/* Account / Contact Info */}
      <section aria-label="Contact information">
        <div className="mt-4 space-y-4">
          <div>
            <label htmlFor="intake-name" className="mb-1 block text-sm font-medium">
              Name <span className="text-destructive" aria-hidden="true">*</span>
            </label>
            <Input
              id="intake-name"
              type="text"
              autoComplete="name"
              aria-required="true"
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? "intake-name-error" : undefined}
              placeholder="Your full name"
              className={errors.name ? "border-destructive" : ""}
              {...register("name")}
            />
            {errors.name && (
              <p id="intake-name-error" className="mt-1 text-sm text-destructive" role="alert">
                {errors.name.message}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="intake-email" className="mb-1 block text-sm font-medium">
              Email <span className="text-destructive" aria-hidden="true">*</span>
            </label>
            <Input
              id="intake-email"
              type="email"
              autoComplete="email"
              aria-required="true"
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? "intake-email-error" : undefined}
              placeholder="you@example.com"
              className={errors.email ? "border-destructive" : ""}
              {...register("email")}
            />
            {errors.email && (
              <p id="intake-email-error" className="mt-1 text-sm text-destructive" role="alert">
                {errors.email.message}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="intake-phone" className="mb-1 block text-sm font-medium">
              Phone <span className="text-destructive" aria-hidden="true">*</span>
            </label>
            <Input
              id="intake-phone"
              type="tel"
              autoComplete="tel"
              aria-required="true"
              aria-invalid={Boolean(errors.phone)}
              aria-describedby={errors.phone ? "intake-phone-error" : undefined}
              placeholder="+1 (555) 000-0000"
              className={errors.phone ? "border-destructive" : ""}
              {...register("phone")}
            />
            {errors.phone && (
              <p id="intake-phone-error" className="mt-1 text-sm text-destructive" role="alert">
                {errors.phone.message}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Service Address */}
      <section aria-label="Service address">
        <h2 className="text-base font-semibold">Service Address</h2>

        <div className="mt-3 space-y-4">
          <div>
            <label htmlFor="intake-address1" className="mb-1 block text-sm font-medium">
              Street Address <span className="text-destructive" aria-hidden="true">*</span>
            </label>
            <Input
              id="intake-address1"
              type="text"
              autoComplete="street-address"
              aria-required="true"
              aria-invalid={Boolean(errors.addressLine1)}
              aria-describedby={errors.addressLine1 ? "intake-address1-error" : undefined}
              placeholder="123 Main St"
              className={errors.addressLine1 ? "border-destructive" : ""}
              {...register("addressLine1")}
            />
            {errors.addressLine1 && (
              <p id="intake-address1-error" className="mt-1 text-sm text-destructive" role="alert">
                {errors.addressLine1.message}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="intake-address2" className="mb-1 block text-sm font-medium">
              Unit / Apt (optional)
            </label>
            <Input
              id="intake-address2"
              type="text"
              autoComplete="address-line2"
              aria-invalid={Boolean(errors.addressLine2)}
              aria-describedby={errors.addressLine2 ? "intake-address2-error" : undefined}
              placeholder="Apt 4B"
              className={errors.addressLine2 ? "border-destructive" : ""}
              {...register("addressLine2")}
            />
            {errors.addressLine2 && (
              <p id="intake-address2-error" className="mt-1 text-sm text-destructive" role="alert">
                {errors.addressLine2.message}
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="intake-city" className="mb-1 block text-sm font-medium">
                City <span className="text-destructive" aria-hidden="true">*</span>
              </label>
              <Input
                id="intake-city"
                type="text"
                autoComplete="address-level2"
                aria-required="true"
                aria-invalid={Boolean(errors.city)}
                aria-describedby={errors.city ? "intake-city-error" : undefined}
                placeholder="Ottawa"
                className={errors.city ? "border-destructive" : ""}
                {...register("city")}
              />
              {errors.city && (
                <p id="intake-city-error" className="mt-1 text-sm text-destructive" role="alert">
                  {errors.city.message}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="intake-province" className="mb-1 block text-sm font-medium">
                Province <span className="text-destructive" aria-hidden="true">*</span>
              </label>
              <select
                id="intake-province"
                className={`h-10 w-full rounded-md border bg-background px-3 text-sm ${
                  errors.province ? "border-destructive" : "border-input"
                }`}
                aria-required="true"
                aria-invalid={Boolean(errors.province)}
                aria-describedby={errors.province ? "intake-province-error" : undefined}
                {...register("province")}
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
          </div>

          <div>
            <label htmlFor="intake-postal" className="mb-1 block text-sm font-medium">
              Postal Code <span className="text-destructive" aria-hidden="true">*</span>
            </label>
            <Input
              id="intake-postal"
              type="text"
              autoComplete="postal-code"
              aria-required="true"
              aria-invalid={Boolean(errors.postalCode)}
              aria-describedby={errors.postalCode ? "intake-postal-error" : undefined}
              placeholder="K1A 0B1"
              className={errors.postalCode ? "border-destructive" : ""}
              {...register("postalCode")}
            />
            {errors.postalCode && (
              <p id="intake-postal-error" className="mt-1 text-sm text-destructive" role="alert">
                {errors.postalCode.message}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Ownership */}
      <fieldset className="pt-2" aria-label="Property ownership status">
        <legend className="text-base font-semibold">Property Ownership</legend>

        <div className="mt-3 space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" value="owner" {...register("ownershipStatus")} />
            Owner
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input type="radio" value="tenant" {...register("ownershipStatus")} />
            Tenant
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input type="radio" value="other" {...register("ownershipStatus")} />
            Other
          </label>

          {errors.ownershipStatus && (
            <p className="mt-1 text-sm text-destructive" role="alert">
              {errors.ownershipStatus.message}
            </p>
          )}
        </div>

        {ownershipStatus === "tenant" && (
          <div className="mt-4 space-y-4 rounded-md border p-3">
            <p className="text-sm text-muted-foreground">
              Please provide your landlord’s contact information.
            </p>

            <div>
              <label htmlFor="intake-landlord-name" className="mb-1 block text-sm font-medium">
                Landlord Name <span className="text-destructive" aria-hidden="true">*</span>
              </label>
              <Input
                id="intake-landlord-name"
                type="text"
                aria-required="true"
                aria-invalid={Boolean(errors.landlordName)}
                aria-describedby={errors.landlordName ? "intake-landlord-name-error" : undefined}
                placeholder="Landlord full name"
                className={errors.landlordName ? "border-destructive" : ""}
                {...register("landlordName")}
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

            <div>
              <label htmlFor="intake-landlord-phone" className="mb-1 block text-sm font-medium">
                Landlord Phone <span className="text-destructive" aria-hidden="true">*</span>
              </label>
              <Input
                id="intake-landlord-phone"
                type="tel"
                autoComplete="tel"
                aria-required="true"
                aria-invalid={Boolean(errors.landlordPhone)}
                aria-describedby={errors.landlordPhone ? "intake-landlord-phone-error" : undefined}
                placeholder="+1 (555) 000-0000"
                className={errors.landlordPhone ? "border-destructive" : ""}
                {...register("landlordPhone")}
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
          <div className="mt-4 space-y-3 rounded-md border p-3">
            <p className="text-sm text-muted-foreground">
              Please briefly explain your ownership situation.
            </p>

            <div>
              <label htmlFor="intake-ownership-other" className="mb-1 block text-sm font-medium">
                Explanation <span className="text-destructive" aria-hidden="true">*</span>
              </label>

              <Input
                id="intake-ownership-other"
                type="text"
                aria-required="true"
                aria-invalid={Boolean(errors.ownershipOtherDetails)}
                aria-describedby={errors.ownershipOtherDetails ? "intake-ownership-other-error" : undefined}
                placeholder="e.g., family member owns the home…"
                className={errors.ownershipOtherDetails ? "border-destructive" : ""}
                {...register("ownershipOtherDetails")}
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
          </div>
        )}
      </fieldset>

      <Button type="submit" disabled={isSubmitting} className="mt-2">
        {isSubmitting ? "Submitting…" : "Submit"}
      </Button>
    </form>
  );
}
