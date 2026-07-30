"use client";

import { useState } from "react";
import { Button } from "@/frontend/components/ui/button";

interface EnrollmentMaterial {
  secret: string;
  otpauthUri: string;
  qrCodeDataUrl: string;
}

interface MfaSetupClientProps {
  initialMfaEnabled: boolean;
  initialEnrolledAt: string | null;
}

export function MfaSetupClient({ initialMfaEnabled, initialEnrolledAt }: MfaSetupClientProps) {
  const [mfaEnabled, setMfaEnabled] = useState(initialMfaEnabled);
  const [enrolledAt, setEnrolledAt] = useState(initialEnrolledAt);
  const [material, setMaterial] = useState<EnrollmentMaterial | null>(null);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);

  async function handleStartEnrollment() {
    setError(null);
    setIsStarting(true);
    try {
      const res = await fetch("/api/admin/mfa/enroll", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to start MFA enrollment");
        return;
      }
      setMaterial(data);
    } catch {
      setError("Failed to start MFA enrollment");
    } finally {
      setIsStarting(false);
    }
  }

  async function handleConfirm() {
    setError(null);
    setIsConfirming(true);
    try {
      const res = await fetch("/api/admin/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Verification failed");
        return;
      }
      setMfaEnabled(true);
      setEnrolledAt(data.enrolledAt);
      setMaterial(null);
      setToken("");
    } catch {
      setError("Verification failed");
    } finally {
      setIsConfirming(false);
    }
  }

  if (mfaEnabled) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-6">
        <p className="font-medium text-green-800">MFA is enabled on your account.</p>
        {enrolledAt ? (
          <p className="mt-1 text-sm text-green-700">
            Enrolled on {new Date(enrolledAt).toLocaleDateString()}.
          </p>
        ) : null}
        <p className="mt-2 text-sm text-gray-600">
          Lost your authenticator device? A system administrator can reset MFA on your account.
        </p>
        {/* Plain <a> (hard navigation), not <Link>: /admin's layout is fully
            dynamic (headers() + a DB call) — see Navigation.tsx for why a
            client-side transition into it is avoided. */}
        <Button asChild variant="outline" className="mt-4">
          <a href="/admin">Back to Advisor Panel</a>
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      {error ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {!material ? (
        <div>
          <p className="text-sm text-gray-600">
            You haven&apos;t set up MFA yet. Generate a QR code to scan with your authenticator app.
          </p>
          <Button className="mt-4" onClick={handleStartEnrollment} disabled={isStarting}>
            {isStarting ? "Generating…" : "Generate QR code"}
          </Button>
        </div>
      ) : (
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={material.qrCodeDataUrl}
            alt="Scan this QR code with your authenticator app"
            className="mx-auto h-48 w-48"
          />
          <p className="mt-4 text-sm text-gray-600">
            Can&apos;t scan the code? Enter this key manually in your authenticator app:
          </p>
          <code className="mt-1 block break-all rounded bg-gray-100 p-2 text-sm">{material.secret}</code>

          <label className="mt-6 block text-sm font-medium text-gray-700" htmlFor="mfa-token">
            Enter the 6-digit code from your authenticator app
          </label>
          <input
            id="mfa-token"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            placeholder="123456"
          />
          <Button className="mt-4" onClick={handleConfirm} disabled={isConfirming || !token.trim()}>
            {isConfirming ? "Verifying…" : "Confirm and enable MFA"}
          </Button>
        </div>
      )}
    </div>
  );
}
