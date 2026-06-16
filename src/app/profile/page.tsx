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

  // Export states
  const [isExportingPdf, setIsExportingPdf] = React.useState(false);
  const [isExportingCsv, setIsExportingCsv] = React.useState(false);
  const [exportError, setExportError] = React.useState<string | null>(null);

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

  const handleExport = async (format: "pdf" | "csv") => {
    setExportError(null);
    if (format === "pdf") setIsExportingPdf(true);
    else setIsExportingCsv(true);

    try {
      const res = await fetch(`/api/profile/export/${format}`);
      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || "Failed to generate your data export file.");
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `personal_data_export_${new Date().toISOString().slice(0, 10)}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "An unexpected error occurred during export.");
    } finally {
      if (format === "pdf") setIsExportingPdf(false);
      else setIsExportingCsv(false);
    }
  };

  if (isLoading) {
    return (
      <main className="min-h-screen p-6 md:p-8 flex items-center justify-center bg-gray-50/50">
        <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </main>
    );
  }

  return (
    <main className="min-h-screen p-6 md:p-8 bg-gray-50/50">
      <div className="mx-auto max-w-2xl space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-gray-900">My Profile</h1>
          <p className="mt-1 text-sm text-gray-500">
            View and update your Landseed account details.
          </p>
        </div>

        {/* 1. Account details form */}
        <section aria-labelledby="profile-settings-title" className="rounded-2xl border bg-white p-6 shadow-sm">
          <h2 id="profile-settings-title" className="text-lg font-bold text-gray-900 mb-4">
            Account Information
          </h2>
          
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" aria-label="Profile form">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="profile-name" className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Name
              </label>
              <input
                id="profile-name"
                type="text"
                {...register("name")}
                className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all shadow-sm text-sm"
                aria-invalid={!!errors.name}
                aria-describedby={errors.name ? "profile-name-error" : undefined}
              />
              {errors.name && (
                <p id="profile-name-error" className="text-xs font-medium text-red-600 mt-1" role="alert">
                  {errors.name.message}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="profile-email" className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Email
              </label>
              <input
                id="profile-email"
                type="email"
                {...register("email")}
                className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all shadow-sm text-sm"
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? "profile-email-error" : undefined}
              />
              {errors.email && (
                <p id="profile-email-error" className="text-xs font-medium text-red-600 mt-1" role="alert">
                  {errors.email.message}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="profile-phone" className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Phone Number
              </label>
              <input
                id="profile-phone"
                type="tel"
                {...register("phone")}
                className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all shadow-sm text-sm"
                aria-invalid={!!errors.phone}
                aria-describedby={errors.phone ? "profile-phone-error" : undefined}
              />
              {errors.phone && (
                <p id="profile-phone-error" className="text-xs font-medium text-red-600 mt-1" role="alert">
                  {errors.phone.message}
                </p>
              )}
            </div>

            {successMessage && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                <p className="text-sm font-semibold text-emerald-800 text-center" role="status">
                  {successMessage}
                </p>
              </div>
            )}

            <Button type="submit" disabled={isSubmitting} className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-medium shadow-sm transition-colors text-sm">
              {isSubmitting ? "Saving…" : "Update Profile"}
            </Button>
          </form>
        </section>

        {/* 2. Personal Data Export panel */}
        <section aria-labelledby="export-section-title" className="rounded-2xl border border-gray-200 bg-white/70 backdrop-blur-md p-6 shadow-sm space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-4">
            <div>
              <h2 id="export-section-title" className="text-lg font-bold text-gray-900 flex items-center gap-1.5">
                <svg className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                Export Personal Data
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                Securely download a full copy of your account profile details, project history, and collaborators permissions.
              </p>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 border border-indigo-200 px-2.5 py-0.5 text-xs font-semibold text-indigo-700">
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.57-.598-3.75h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
              Secure Export
            </span>
          </div>

          {exportError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl" role="alert">
              <p className="text-sm text-red-700 text-center font-medium">{exportError}</p>
            </div>
          )}

          {/* Formats Grid */}
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Format 1: PDF */}
            <div className="flex flex-col justify-between rounded-xl border border-gray-150 bg-white p-5 shadow-sm space-y-4 transition-all duration-200 hover:shadow-md hover:border-emerald-200">
              <div className="space-y-1.5">
                <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                  <svg className="h-4.5 w-4.5 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                  Portable Document Format (PDF)
                </h3>
                <p className="text-xs text-gray-500 leading-relaxed">
                  Generates a beautifully formatted PDF report containing all your contact details, active home modification listings, and shared access history. Ideal for viewing, printing, or archiving.
                </p>
              </div>
              
              <button
                type="button"
                onClick={() => handleExport("pdf")}
                disabled={isExportingPdf || isExportingCsv}
                aria-label="Download personal data report as PDF"
                className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-xs transition-colors disabled:opacity-50"
              >
                {isExportingPdf ? (
                  <>
                    <span className="h-3 w-3 rounded-full border border-white border-t-transparent animate-spin" />
                    Generating PDF…
                  </>
                ) : (
                  <>
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                    </svg>
                    Download PDF
                  </>
                )}
              </button>
            </div>

            {/* Format 2: CSV */}
            <div className="flex flex-col justify-between rounded-xl border border-gray-150 bg-white p-5 shadow-sm space-y-4 transition-all duration-200 hover:shadow-md hover:border-indigo-200">
              <div className="space-y-1.5">
                <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                  <svg className="h-4.5 w-4.5 text-blue-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
                  </svg>
                  Comma-Separated Values (CSV)
                </h3>
                <p className="text-xs text-gray-500 leading-relaxed">
                  Generates an RFC 4180 escaped CSV table. This structured tabular format maps all profile variables, active addresses, and caregiver access roles. Highly suited for importing into Excel or spreadsheet databases.
                </p>
              </div>

              <button
                type="button"
                onClick={() => handleExport("csv")}
                disabled={isExportingPdf || isExportingCsv}
                aria-label="Download personal data spreadsheet as CSV"
                className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs transition-colors disabled:opacity-50"
              >
                {isExportingCsv ? (
                  <>
                    <span className="h-3 w-3 rounded-full border border-white border-t-transparent animate-spin" />
                    Generating CSV…
                  </>
                ) : (
                  <>
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                    </svg>
                    Download CSV
                  </>
                )}
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}