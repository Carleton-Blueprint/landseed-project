"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthPageShell } from "@/frontend/components/auth/AuthPageShell";
import { Button } from "@/frontend/components/ui/button";

const GENERIC_SUCCESS_MESSAGE =
  "If an account exists for that email, we sent password reset instructions.";

export function ForgotPasswordPageContent() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Please enter a valid email address.");
        return;
      }

      setSubmitted(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <AuthPageShell
      title="Reset your password"
      description="Enter your email and we will send you a secure link to choose a new password."
    >
      {submitted ? (
        <div className="space-y-5">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-base text-emerald-900">
            {GENERIC_SUCCESS_MESSAGE}
          </div>
          <Link
            href="/auth/signin"
            className="block text-center text-base font-medium text-emerald-700 hover:underline"
          >
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-base text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all shadow-sm"
              placeholder="jane@example.com"
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
            {isLoading ? "Sending..." : "Send reset link"}
          </Button>

          <Link
            href="/auth/signin"
            className="block text-center text-base font-medium text-emerald-700 hover:underline"
          >
            Back to sign in
          </Link>
        </form>
      )}
    </AuthPageShell>
  );
}
