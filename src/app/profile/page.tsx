"use client";

import React from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/frontend/components/ui/button";

const profileSchema = z.object({
  name: z.string().min(1, "Name is required").max(120, "Name is too long"),
  email: z.string().min(1, "Email is required").email("Enter a valid email"),
  phone: z
    .string()
    .min(1, "Phone is required")
    .regex(/^[\d\s\-+()]*$/, "Phone can only contain digits and + - ( )")
    .max(24, "Phone number is too long"),
  mailingAddress: z
    .string()
    .min(1, "Mailing address is required")
    .max(200, "Mailing address is too long"),
});

type ProfileFormValues = z.infer<typeof profileSchema>;

const defaultValues: ProfileFormValues = {
  name: "",
  email: "",
  phone: "",
  mailingAddress: "",
};

export default function ProfilePage() {
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues,
    mode: "onBlur",
  });

  async function onSubmit(values: ProfileFormValues) {
    console.log("Profile updated:", values);
    setSuccessMessage("Profile updated successfully.");
  }

  return (
    <main className="min-h-screen p-6 md:p-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My Profile</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Update your account information below.
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" aria-label="Profile form">
          <div className="flex flex-col gap-2">
            <label htmlFor="profile-name" className="text-sm font-medium">
              Name
            </label>
            <input
              id="profile-name"
              type="text"
              {...register("name")}
              className="rounded border border-input bg-background px-3 py-2 text-sm"
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? "profile-name-error" : undefined}
            />
            {errors.name && (
              <p id="profile-name-error" className="text-sm text-destructive" role="alert">
                {errors.name.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="profile-email" className="text-sm font-medium">
              Email
            </label>
            <input
              id="profile-email"
              type="email"
              {...register("email")}
              className="rounded border border-input bg-background px-3 py-2 text-sm"
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? "profile-email-error" : undefined}
            />
            {errors.email && (
              <p id="profile-email-error" className="text-sm text-destructive" role="alert">
                {errors.email.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="profile-phone" className="text-sm font-medium">
              Phone number
            </label>
            <input
              id="profile-phone"
              type="tel"
              {...register("phone")}
              className="rounded border border-input bg-background px-3 py-2 text-sm"
              aria-invalid={!!errors.phone}
              aria-describedby={errors.phone ? "profile-phone-error" : undefined}
            />
            {errors.phone && (
              <p id="profile-phone-error" className="text-sm text-destructive" role="alert">
                {errors.phone.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="profile-mailing-address" className="text-sm font-medium">
              Mailing address
            </label>
            <textarea
              id="profile-mailing-address"
              {...register("mailingAddress")}
              className="min-h-24 rounded border border-input bg-background px-3 py-2 text-sm"
              aria-invalid={!!errors.mailingAddress}
              aria-describedby={errors.mailingAddress ? "profile-mailing-address-error" : undefined}
            />
            {errors.mailingAddress && (
              <p
                id="profile-mailing-address-error"
                className="text-sm text-destructive"
                role="alert"
              >
                {errors.mailingAddress.message}
              </p>
            )}
          </div>

          {successMessage && (
            <p className="text-sm text-green-700" role="status">
              {successMessage}
            </p>
          )}

          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Update Profile"}
          </Button>
        </form>
      </div>
    </main>
  );
}