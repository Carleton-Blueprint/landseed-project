"use client";

import { useSearchParams } from "next/navigation";

const VERIFICATION_MESSAGES: Record<string, { tone: "success" | "error"; message: string }> = {
  success: {
    tone: "success",
    message: "Your email is verified. You can sign in now.",
  },
  expired: {
    tone: "error",
    message:
      "That verification link has expired. Sign in and use “Resend verification email” on your dashboard to get a new link.",
  },
  invalid: {
    tone: "error",
    message: "That verification link is not valid. Request a new verification email after you sign in.",
  },
  used: {
    tone: "error",
    message: "That verification link was already used. Sign in to continue.",
  },
};

export function SignInVerificationAlert() {
  const searchParams = useSearchParams();
  const status = searchParams.get("verified");
  if (!status) return null;

  const content = VERIFICATION_MESSAGES[status];
  if (!content) return null;

  const className =
    content.tone === "success"
      ? "mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-base text-emerald-900"
      : "mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-base text-red-900";

  return (
    <div role="status" className={className}>
      {content.message}
    </div>
  );
}
