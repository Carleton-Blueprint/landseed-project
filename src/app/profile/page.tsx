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
    .max(24, "Phone number is too long")
    .optional()
    .or(z.literal("")),
});

type ProfileFormValues = z.infer<typeof profileSchema>;

const defaultValues: ProfileFormValues = {
  name: "",
  email: "",
  phone: "",
};

export default function ProfilePage() {
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);

  const [isLoading, setIsLoading] = React.useState(true);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues,
    mode: "onBlur",
  });

  React.useEffect(() => {
    async function loadProfile() {
      try {
        const res = await fetch("/api/profile");
        if (res.ok) {
          const data = await res.json();
          reset({
            name: data.name || "",
            email: data.email || "",
            phone: data.phone || "",
          });
        }
      } catch (err) {
        console.error("Failed to load profile", err);
      } finally {
        setIsLoading(false);
      }
    }
    loadProfile();
  }, [reset]);

  async function onSubmit(values: ProfileFormValues) {
    setSuccessMessage(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      if (res.ok) {
        setSuccessMessage("Profile updated successfully.");
      } else {
        const data = await res.json();
        console.error("Update failed:", data.error);
      }
    } catch (err) {
      console.error("Error updating profile", err);
    }
  }

  if (isLoading) {
    return (
      <main className="min-h-screen p-6 md:p-8 flex items-center justify-center">
        <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </main>
    );
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

          {/* Mailing address removed as it is not in the schema */}

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