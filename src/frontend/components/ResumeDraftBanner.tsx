"use client";

import { useEffect, useRef, useState } from "react";
import { useIntakeDraft } from "@/frontend/contexts/IntakeDraftContext";
import { getResumeScrollTargetId } from "@/frontend/lib/intakeDraftResume";
import { ClipboardIcon } from "@/frontend/components/icons";

export function ResumeDraftBanner() {
  const { guidedData, isHydrated, restoredAt } = useIntakeDraft();
  const [dismissed, setDismissed] = useState(false);
  const hasScrolledRef = useRef(false);

  const showBanner = isHydrated && restoredAt !== null && !dismissed;

  useEffect(() => {
    if (!showBanner || hasScrolledRef.current) return;

    const targetId = getResumeScrollTargetId(guidedData);
    const element = document.getElementById(targetId);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
      hasScrolledRef.current = true;
    }
  }, [showBanner, guidedData]);

  if (!showBanner) return null;

  return (
    <div
      role="status"
      className="mb-6 flex items-start justify-between gap-3 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800"
    >
      <span className="flex items-center gap-1.5">
        <ClipboardIcon size={16} className="shrink-0 text-blue-500" />
        Welcome back — we saved your progress
        {restoredAt && (
          <span className="text-blue-600">
            (last saved {restoredAt.toLocaleString()})
          </span>
        )}
      </span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="shrink-0 font-medium hover:underline"
      >
        Dismiss
      </button>
    </div>
  );
}
