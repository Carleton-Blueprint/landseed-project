"use client";

import React, { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, AlertTriangle, Loader2, ArrowRight, ShieldCheck } from "lucide-react";

function ConfirmEmailChangeContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const step = searchParams.get("step");

  const [status, setStatus] = React.useState<"loading" | "success" | "error">("loading");
  const [errorReason, setErrorReason] = React.useState<string | null>(null);
  const [pendingNewEmail, setPendingNewEmail] = React.useState<string | null>(null);
  const [finalEmail, setFinalEmail] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!token || (step !== "current" && step !== "new")) {
      setStatus("error");
      setErrorReason("invalid");
      return;
    }

    async function verifyToken() {
      try {
        const res = await fetch("/api/profile/change-email/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, step }),
        });

        const data = await res.json();
        if (res.ok) {
          setStatus("success");
          if (step === "current") {
            setPendingNewEmail(data.pendingEmail);
          } else {
            setFinalEmail(data.email);
          }
        } else {
          setStatus("error");
          setErrorReason(data.error || "invalid");
        }
      } catch (err) {
        console.error("Verification error:", err);
        setStatus("error");
        setErrorReason("invalid");
      }
    }

    verifyToken();
  }, [token, step]);

  if (status === "loading") {
    return (
      <div className="flex flex-col items-center justify-center space-y-4 py-12 bg-white border border-gray-150 rounded-2xl shadow-sm">
        <Loader2 className="h-10 w-10 text-emerald-600 animate-spin" />
        <h2 className="text-xl font-semibold text-gray-900">Verifying Request...</h2>
        <p className="text-sm text-gray-500">Please wait while we confirm your email ownership.</p>
      </div>
    );
  }

  if (status === "error") {
    let title = "Verification Failed";
    let desc = "This verification link is invalid or has expired.";
    if (errorReason === "expired") {
      title = "Verification Link Expired";
      desc = "The security token has expired (links are valid for 24 hours). Please request a new email change from your profile page.";
    } else if (errorReason === "already_used") {
      title = "Link Already Used";
      desc = "This verification link has already been used. If you are completing the change, check if the email address was updated.";
    }

    return (
      <div className="flex flex-col items-center text-center space-y-5 p-6 md:p-8 bg-white border border-gray-150 rounded-2xl shadow-sm">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-bold text-gray-900">{title}</h2>
          <p className="text-sm text-gray-500 leading-relaxed max-w-sm">{desc}</p>
        </div>
        <Link
          href="/profile"
          className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-sm transition-colors shadow-sm"
        >
          Go to Profile Settings
        </Link>
      </div>
    );
  }

  // Success view
  return (
    <div className="bg-white border border-gray-150 rounded-2xl shadow-sm overflow-hidden">
      {/* Header Banner */}
      <div className="bg-emerald-600 p-6 md:p-8 text-white text-center space-y-2">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-white/20 text-white">
          {step === "new" ? <ShieldCheck className="h-6 w-6" /> : <CheckCircle2 className="h-6 w-6" />}
        </div>
        <h2 className="text-xl font-bold">
          {step === "new" ? "Email Address Updated!" : "Step 1 Verified!"}
        </h2>
        <p className="text-sm text-emerald-100">
          {step === "new" ? "Your email change is complete." : "Your current email has been verified."}
        </p>
      </div>

      {/* Content */}
      <div className="p-6 md:p-8 space-y-6">
        {/* Progress Tracker Diagram */}
        <div className="flex items-center justify-between max-w-xs mx-auto text-xs font-semibold text-gray-500">
          <div className="flex flex-col items-center space-y-1">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 font-bold border border-emerald-300">
              1
            </div>
            <span className="text-gray-900 font-bold">Current Email</span>
          </div>
          <ArrowRight className="h-4 w-4 text-emerald-600" />
          <div className="flex flex-col items-center space-y-1">
            <div className={`flex h-6 w-6 items-center justify-center rounded-full font-bold border ${step === 'new' ? 'bg-emerald-100 text-emerald-700 border-emerald-300' : 'bg-gray-100 text-gray-405 border-gray-200'}`}>
              2
            </div>
            <span className={step === 'new' ? 'text-gray-900 font-bold' : ''}>New Email</span>
          </div>
        </div>

        <div className="border-t border-gray-100 my-4" />

        {step === "current" ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-gray-600 leading-relaxed max-w-md mx-auto">
              We have verified ownership of your current email address. A second verification link has been sent to your new email address: <strong>{pendingNewEmail}</strong>.
            </p>
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl max-w-sm mx-auto">
              <p className="text-xs font-bold text-amber-900">
                Action Required:
              </p>
              <p className="text-xs text-amber-800 mt-0.5">
                Please check your new inbox and click the confirmation link to complete the change.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4 text-center">
            <p className="text-sm text-gray-600 leading-relaxed max-w-md mx-auto">
              Congratulations! Your email has been successfully updated to <strong>{finalEmail}</strong>. You can now use this email address to log in to your Landseed account.
            </p>
          </div>
        )}

        <div className="flex justify-center pt-2">
          <Link
            href="/profile"
            className="inline-flex items-center gap-1.5 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm transition-colors shadow-sm"
          >
            Go to My Profile
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function ConfirmEmailChangePage() {
  return (
    <main className="min-h-screen p-6 md:p-8 bg-gray-50/50 flex items-center justify-center">
      <div className="w-full max-w-md">
        <Suspense
          fallback={
            <div className="flex flex-col items-center justify-center space-y-4 py-12 bg-white border rounded-2xl shadow-sm">
              <Loader2 className="h-8 w-8 text-emerald-600 animate-spin" />
              <p className="text-sm text-gray-500">Loading page...</p>
            </div>
          }
        >
          <ConfirmEmailChangeContent />
        </Suspense>
      </div>
    </main>
  );
}
