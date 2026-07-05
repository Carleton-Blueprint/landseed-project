"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { AuthPageShell } from "@/frontend/components/auth/AuthPageShell";
import { Button } from "@/frontend/components/ui/button";
import { Input } from "@/frontend/components/ui/input";
import { 
  Mail, 
  Sparkles, 
  CheckCircle2, 
  AlertCircle, 
  ArrowLeft, 
  RefreshCw, 
  ShieldCheck, 
  HelpCircle 
} from "lucide-react";

export function ForgotPasswordPageContent() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);

  useEffect(() => {
    if (resendCountdown > 0) {
      const timer = setTimeout(() => setResendCountdown(prev => prev - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCountdown]);

  async function handleSubmit(event: React.FormEvent, isResend = false) {
    event.preventDefault();
    if (!email.trim()) {
      setError("Please enter your email address.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Please enter a valid email address.");
        return;
      }

      setSubmitted(true);
      if (isResend) {
        setResendCountdown(30);
      }
    } catch {
      setError("Something went wrong while connecting to InPlace AI Support. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <AuthPageShell
      title="Account Recovery"
      description="Securely reset your LandSeed password online—no need to wait on hold or call customer support."
    >
      {/* Reassurance Badge */}
      <div className="mb-6 flex items-center justify-center gap-2 rounded-xl bg-emerald-50/90 py-2 px-4 border border-emerald-200/80 text-emerald-800 text-xs font-semibold shadow-2xs">
        <Sparkles className="h-4 w-4 text-emerald-600 animate-pulse shrink-0" />
        <span>Protected by InPlace AI Security — Automated Recovery</span>
      </div>

      {submitted ? (
        <div className="space-y-6 animate-in fade-in zoom-in-95 duration-300">
          <div className="rounded-2xl border border-emerald-200 bg-gradient-to-b from-emerald-50/90 to-white p-6 shadow-sm text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 shadow-inner">
              <CheckCircle2 className="h-8 w-8" />
            </div>
            <h3 className="text-xl font-bold text-gray-900">Check Your Inbox</h3>
            <p className="mt-2 text-base text-gray-700 leading-relaxed">
              If an account exists for <strong className="text-gray-900">{email}</strong>, we’ve sent secure password reset instructions.
            </p>
          </div>

          {/* Senior Guidance Card */}
          <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-4.5 space-y-2 text-left shadow-2xs">
            <div className="flex items-center gap-2 text-blue-900 font-semibold text-sm">
              <HelpCircle className="h-4 w-4 text-blue-600 shrink-0" />
              <span>Haven&apos;t received the email yet?</span>
            </div>
            <ul className="text-xs text-blue-800 space-y-1.5 list-disc list-inside ml-1 leading-relaxed">
              <li>Emails usually arrive within 1–2 minutes.</li>
              <li>Check your <strong>Spam</strong> or <strong>Junk</strong> folder just in case.</li>
              <li>Make sure there were no typos in your email address.</li>
            </ul>
          </div>

          <div className="pt-2 flex flex-col gap-3">
            <Button
              type="button"
              onClick={(e) => void handleSubmit(e, true)}
              disabled={isLoading || resendCountdown > 0}
              variant="outline"
              className="w-full h-12 rounded-xl font-medium text-base border-gray-300 hover:bg-gray-50 flex items-center justify-center gap-2 transition-all shadow-2xs"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
              {resendCountdown > 0 ? `Resend email in ${resendCountdown}s` : "Send reset link again"}
            </Button>

            <Link href="/auth/signin" className="w-full">
              <Button
                variant="default"
                className="w-full h-12 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl font-semibold text-base shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2"
              >
                <ArrowLeft className="h-4 w-4" />
                Return to Sign In
              </Button>
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Senior Self-Service Explainer */}
          <div className="rounded-xl bg-gray-50 border border-gray-200/80 p-4 text-left space-y-2 shadow-2xs">
            <div className="flex items-center gap-2 text-gray-900 font-semibold text-xs sm:text-sm">
              <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
              <span>How automated account recovery works:</span>
            </div>
            <ol className="text-xs text-gray-600 space-y-1.5 list-decimal list-inside ml-1 leading-relaxed">
              <li>Enter the email address tied to your home adaptation request.</li>
              <li>Check your email inbox for a private confirmation link.</li>
              <li>Click the link to instantly create a new password online.</li>
            </ol>
          </div>

          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
            <div>
              <label htmlFor="email" className="block text-sm font-semibold text-gray-800 mb-1.5">
                Email Address
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-gray-400">
                  <Mail className="h-4 w-4" />
                </div>
                <Input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="pl-10 h-11 rounded-xl border-gray-200 bg-white/80 text-gray-900 placeholder-gray-400 focus-visible:ring-emerald-500 focus-visible:border-emerald-500 shadow-2xs transition-all text-base sm:text-sm"
                  placeholder="mary.smith@example.com"
                />
              </div>
              {email && !email.includes("@") && (
                <p className="mt-1.5 text-xs text-amber-600 font-medium">
                  Please make sure to include the &quot;@&quot; symbol in your email.
                </p>
              )}
            </div>

            {error && (
              <div className="flex items-center gap-2.5 p-3.5 bg-red-50 border border-red-200/80 rounded-xl text-red-700 text-sm animate-in fade-in-50 duration-200">
                <AlertCircle className="h-5 w-5 text-red-500 shrink-0" />
                <p className="font-medium">{error}</p>
              </div>
            )}

            <Button
              type="submit"
              disabled={isLoading}
              className="w-full h-12 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl font-semibold text-base shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Sending instructions...</span>
                </>
              ) : (
                <span>Send Password Reset Link</span>
              )}
            </Button>

            <div className="pt-2 text-center">
              <Link
                href="/auth/signin"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-600 hover:text-emerald-700 hover:underline transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Sign In
              </Link>
            </div>
          </form>
        </div>
      )}
    </AuthPageShell>
  );
}
