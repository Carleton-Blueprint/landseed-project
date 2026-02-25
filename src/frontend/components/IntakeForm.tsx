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

const intakeSchema = z.object({
  name: z.string().min(1, "Name is required").max(120, "Name is too long"),
  email: z.string().email("Enter a valid email").optional().or(z.literal("")),
  phone: z
    .string()
    .regex(/^[\d\s\-+()]*$/, "Phone can only contain digits and + - ( )")
    .max(24, "Phone number is too long")
    .optional()
    .or(z.literal("")),
});

export type IntakeFormValues = z.infer<typeof intakeSchema>;

const defaultValues: IntakeFormValues = {
  name: "",
  email: "",
  phone: "",
};

export function IntakeForm() {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<IntakeFormValues>({
    resolver: zodResolver(intakeSchema),
    defaultValues,
  });

  async function onSubmit(values: IntakeFormValues) {
      // Small job: submit to API when ready
      try {
        const response = await fetch('/api/intake', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(values),
        });

        if (!response.ok) {
          // Handle HTTP errors (4xx, 5xx)
          const error = await response.json();
          console.error('Error:', error);
          return;
        }

        const data = await response.json();
        console.log("Intake submitted successfully", data);
        console.log("Submitted values:", values);
      
    } catch (error) {
        // Handle network errors
        console.error('Network error:', error);
    }
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-4"
      noValidate
      aria-label="Digital intake form"
    >
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
          Email
        </label>
        <Input
          id="intake-email"
          type="email"
          autoComplete="email"
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
          Phone
        </label>
        <Input
          id="intake-phone"
          type="tel"
          autoComplete="tel"
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

      <Button type="submit" disabled={isSubmitting} className="mt-2">
        {isSubmitting ? "Submitting…" : "Submit"}
      </Button>
    </form>
  );
}
