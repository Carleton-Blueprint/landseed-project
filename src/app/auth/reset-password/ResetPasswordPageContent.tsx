"use client";

import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthPageShell } from "@/frontend/components/auth/AuthPageShell";
import { Button } from "@/frontend/components/ui/button";
import { Input } from "@/frontend/components/ui/input";
import { 
  Lock, 
  Eye, 
  EyeOff, 
  CheckCircle2, 
  AlertCircle, 
  ArrowRight, 
  ShieldCheck
} from "lucide-react";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Live real-time password checks (minimum 8 characters, uppercase, lowercase, number, special character)
  const isLengthValid = password.length >= 8;
  const isUpperValid = /[A-Z]/.test(password);
  const isLowerValid = /[a-z]/.test(password);
  const isNumberValid = /[0-9]/.test(password);
  const isSpecialValid = /[^A-Za-z0-9]/.test(password);
  const doPasswordsMatch = password.length > 0 && password === confirmPassword;

  const isAllValid =
    isLengthValid &&
    isUpperValid &&
    isLowerValid &&
    isNumberValid &&
    isSpecialValid &&
    doPasswordsMatch;

  if (!token) {
    return (
      <div className="space-y-6 animate-in fade-in zoom-in-95 duration-300">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center shadow-sm">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-600">
            <AlertCircle className="h-6 w-6" />
          </div>
          <h3 className="text-lg font-bold text-amber-900">Link Expired or Invalid</h3>
          <p className="mt-2 text-sm text-amber-800 leading-relaxed">
            For your security, password recovery links expire after a short period or once used. Please request a new self-recovery email below.
          </p>
        </div>
        <Link href="/auth/forgot-password" className="block w-full">
          <Button className="w-full h-12 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl font-semibold text-base shadow-md transition-all flex items-center justify-center gap-2">
            <span>Request a New Reset Link</span>
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </div>
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!isAllValid) {
      setError("Please satisfy all password security requirements before saving.");
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
        setError(body?.error ?? "Could not reset your password securely. Please try again.");
        return;
      }

      const msg = body?.message ?? "Your password has been reset successfully. You can sign in now.";
      setSuccessMessage(msg);
      router.push(`/auth/signin?reset=success&message=${encodeURIComponent(msg)}`);
    } catch {
      setError("Something went wrong while communicating with InPlace AI Security. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  if (successMessage) {
    return (
      <div className="space-y-6 animate-in fade-in zoom-in-95 duration-300">
        <div className="rounded-2xl border border-emerald-200 bg-gradient-to-b from-emerald-50/90 to-white p-6 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 shadow-inner">
            <CheckCircle2 className="h-8 w-8" />
          </div>
          <h3 className="text-xl font-bold text-gray-900">Password Updated!</h3>
          <p className="mt-2 text-base text-gray-700 leading-relaxed">
            {successMessage}
          </p>
          <p className="mt-2 text-sm font-semibold text-emerald-700 animate-pulse">
            Redirecting to sign in page...
          </p>
        </div>
        <Link href="/auth/signin?reset=success" className="block w-full">
          <Button className="w-full h-12 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl font-semibold text-base shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2">
            <span>Proceed to Sign In</span>
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Reassurance Badge */}
      <div className="flex items-center justify-center gap-2 rounded-xl bg-emerald-50/90 py-2 px-4 border border-emerald-200/80 text-emerald-800 text-xs font-semibold shadow-2xs">
        <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
        <span>InPlace AI Encrypted Portal — Secure Password Reset</span>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="password" className="block text-sm font-semibold text-gray-800 mb-1.5">
            New Password
          </label>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-gray-400">
              <Lock className="h-4 w-4" />
            </div>
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="pl-10 pr-11 h-11 rounded-xl border-gray-200 bg-white/80 text-gray-900 placeholder-gray-400 focus-visible:ring-emerald-500 focus-visible:border-emerald-500 shadow-2xs transition-all text-base sm:text-sm"
              placeholder="At least 8 characters"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-gray-400 hover:text-gray-600 focus:outline-none transition-colors"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div>
          <label htmlFor="confirmPassword" className="block text-sm font-semibold text-gray-800 mb-1.5">
            Confirm New Password
          </label>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-gray-400">
              <Lock className="h-4 w-4" />
            </div>
            <Input
              id="confirmPassword"
              type={showConfirmPassword ? "text" : "password"}
              required
              minLength={8}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="pl-10 pr-11 h-11 rounded-xl border-gray-200 bg-white/80 text-gray-900 placeholder-gray-400 focus-visible:ring-emerald-500 focus-visible:border-emerald-500 shadow-2xs transition-all text-base sm:text-sm"
              placeholder="Re-enter your new password"
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-gray-400 hover:text-gray-600 focus:outline-none transition-colors"
              aria-label={showConfirmPassword ? "Hide password" : "Show password"}
            >
              {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Live Senior Checklist with Real-time Feedback */}
        <div className="rounded-xl bg-gray-50/90 border border-gray-200/80 p-3.5 space-y-2 shadow-2xs">
          <p className="text-xs font-bold uppercase tracking-wider text-gray-700 flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            Secure Password Requirements
          </p>
          <ul className="space-y-1.5 text-xs">
            <li
              className={`flex items-center gap-2 font-medium transition-colors ${
                isLengthValid ? "text-emerald-700 font-semibold" : "text-gray-500"
              }`}
            >
              <CheckCircle2
                className={`h-4 w-4 shrink-0 ${
                  isLengthValid ? "text-emerald-600" : "text-gray-300"
                }`}
              />
              <span>At least 8 characters long</span>
            </li>
            <li
              className={`flex items-center gap-2 font-medium transition-colors ${
                isUpperValid ? "text-emerald-700 font-semibold" : "text-gray-500"
              }`}
            >
              <CheckCircle2
                className={`h-4 w-4 shrink-0 ${
                  isUpperValid ? "text-emerald-600" : "text-gray-300"
                }`}
              />
              <span>At least one uppercase letter (A–Z)</span>
            </li>
            <li
              className={`flex items-center gap-2 font-medium transition-colors ${
                isLowerValid ? "text-emerald-700 font-semibold" : "text-gray-500"
              }`}
            >
              <CheckCircle2
                className={`h-4 w-4 shrink-0 ${
                  isLowerValid ? "text-emerald-600" : "text-gray-300"
                }`}
              />
              <span>At least one lowercase letter (a–z)</span>
            </li>
            <li
              className={`flex items-center gap-2 font-medium transition-colors ${
                isNumberValid ? "text-emerald-700 font-semibold" : "text-gray-500"
              }`}
            >
              <CheckCircle2
                className={`h-4 w-4 shrink-0 ${
                  isNumberValid ? "text-emerald-600" : "text-gray-300"
                }`}
              />
              <span>At least one number (0–9)</span>
            </li>
            <li
              className={`flex items-center gap-2 font-medium transition-colors ${
                isSpecialValid ? "text-emerald-700 font-semibold" : "text-gray-500"
              }`}
            >
              <CheckCircle2
                className={`h-4 w-4 shrink-0 ${
                  isSpecialValid ? "text-emerald-600" : "text-gray-300"
                }`}
              />
              <span>At least one special character (!@#$%^&*)</span>
            </li>
            <li
              className={`flex items-center gap-2 font-medium transition-colors ${
                doPasswordsMatch ? "text-emerald-700 font-semibold" : "text-gray-500"
              }`}
            >
              <CheckCircle2
                className={`h-4 w-4 shrink-0 ${
                  doPasswordsMatch ? "text-emerald-600" : "text-gray-300"
                }`}
              />
              <span>Both passwords match exactly</span>
            </li>
          </ul>
        </div>

        {error && (
          <div className="space-y-3 p-3.5 bg-red-50 border border-red-200/80 rounded-xl text-red-700 text-sm animate-in fade-in-50 duration-200">
            <div className="flex items-center gap-2.5">
              <AlertCircle className="h-5 w-5 text-red-500 shrink-0" />
              <p className="font-medium">{error}</p>
            </div>
            {(error.toLowerCase().includes("expired") ||
              error.toLowerCase().includes("invalid") ||
              error.toLowerCase().includes("used") ||
              error.toLowerCase().includes("token")) && (
              <div className="pt-2 border-t border-red-200/60">
                <Link href="/auth/forgot-password" className="block">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full h-10 border-red-300 text-red-800 hover:bg-red-100/50 font-semibold text-xs flex items-center justify-center gap-1.5"
                  >
                    <span>Request a New Reset Link</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </Link>
              </div>
            )}
          </div>
        )}

        <Button
          type="submit"
          disabled={isLoading || !isAllValid}
          className="w-full h-12 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl font-semibold text-base shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <>
              <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <span>Securing account...</span>
            </>
          ) : (
            <span>Save New Password</span>
          )}
        </Button>

        <div className="pt-2 text-center">
          <Link
            href="/auth/signin"
            className="text-sm font-semibold text-emerald-600 hover:text-emerald-700 hover:underline transition-colors inline-flex items-center gap-1"
          >
            Cancel and return to Sign In
          </Link>
        </div>
      </form>
    </div>
  );
}

export function ResetPasswordPageContent() {
  return (
    <AuthPageShell
      title="Create New Password"
      description="Choose a secure password to protect your LandSeed renovation account."
    >
      <Suspense
        fallback={
          <div className="h-48 flex flex-col items-center justify-center gap-3">
            <div className="w-8 h-8 border-3 border-emerald-600 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm font-medium text-gray-600">Loading secure recovery portal...</span>
          </div>
        }
      >
        <ResetPasswordForm />
      </Suspense>
    </AuthPageShell>
  );
}
