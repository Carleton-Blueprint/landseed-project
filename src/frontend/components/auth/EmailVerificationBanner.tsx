"use client";

import { useState } from "react";
import { Button } from "@/frontend/components/ui/button";

type EmailVerificationBannerProps = {
  email: string;
};

export function EmailVerificationBanner({ email }: EmailVerificationBannerProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [isSending, setIsSending] = useState(false);

  async function handleResend() {
    setIsSending(true);
    setMessage(null);
    setIsError(false);

    try {
      const response = await fetch("/api/auth/resend-verification", { method: "POST" });
      const body = (await response.json().catch(() => null)) as {
        message?: string;
        error?: string;
      } | null;

      if (!response.ok) {
        setIsError(true);
        setMessage(body?.error ?? "Could not send verification email. Please try again.");
        return;
      }

      setMessage(body?.message ?? "Verification email sent.");
    } catch {
      setIsError(true);
      setMessage("Could not send verification email. Please try again.");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div
      role="status"
      className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-amber-950"
    >
      <p className="text-lg font-semibold">Please verify your email</p>
      <p className="mt-2 text-base text-amber-900">
        We sent a verification link to <strong>{email}</strong>. Check your inbox and spam folder,
        then click the link to confirm your account.
      </p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button
          type="button"
          onClick={handleResend}
          disabled={isSending}
          className="bg-amber-700 hover:bg-amber-800 text-white text-base py-5 px-6"
        >
          {isSending ? "Sending..." : "Resend verification email"}
        </Button>
        {message && (
          <p className={`text-base ${isError ? "text-red-700" : "text-emerald-800"}`}>{message}</p>
        )}
      </div>
    </div>
  );
}
