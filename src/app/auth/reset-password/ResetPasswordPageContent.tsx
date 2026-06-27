"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthPageShell } from "@/frontend/components/auth/AuthPageShell";
import { Button } from "@/frontend/components/ui/button";

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  if (!token) {
    return (
      <div className="space-y-5">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-base text-red-900">
          This reset link is missing or invalid. Please request a new password reset email.
        </div>
        <Link
          href="/auth/forgot-password"
          className="block text-center text-base font-medium text-emerald-700 hover:underline"
        >
          Request a new reset link
        </Link>
      </div>
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      const body = (await response.json().catch(() => null)) as {
        message?: string;
        error?: string;
      } | null;

      if (!response.ok) {
        setError(body?.error ?? "Could not reset your password. Please try again.");
        return;
      }

      setSuccessMessage(body?.message ?? "Your password has been reset. You can sign in now.");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  if (successMessage) {
    return (
      <div className="space-y-5">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-base text-emerald-900">
          {successMessage}
        </div>
        <Link
          href="/auth/signin"
          className="block text-center text-base font-medium text-emerald-700 hover:underline"
        >
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
          New password
        </label>
        <input
          id="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-base text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all shadow-sm"
          placeholder="At least 8 characters"
        />
      </div>

      <div>
        <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-1">
          Confirm new password
        </label>
        <input
          id="confirmPassword"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-base text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all shadow-sm"
          placeholder="Re-enter your password"
        />
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3">
          <p className="text-base text-red-600 text-center">{error}</p>
        </div>
      )}

      <Button
        type="submit"
        disabled={isLoading}
        className="w-full py-6 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-medium text-base"
      >
        {isLoading ? "Saving..." : "Set new password"}
      </Button>

      <Link
        href="/auth/signin"
        className="block text-center text-base font-medium text-emerald-700 hover:underline"
      >
        Back to sign in
      </Link>
    </form>
  );
}

export function ResetPasswordPageContent() {
  return (
    <AuthPageShell
      title="Choose a new password"
      description="Enter a new password for your Landseed account."
    >
      <Suspense
        fallback={
          <div className="h-40 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          </div>
        }
      >
        <ResetPasswordForm />
      </Suspense>
    </AuthPageShell>
  );
}
