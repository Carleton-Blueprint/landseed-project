"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/frontend/components/ui/button";

interface AlertThreshold {
  key: string;
  label: string;
  thresholdCount: number;
  windowMinutes: number;
  enabled: boolean;
}

export function AdminAlertThresholdsPanel() {
  const [thresholds, setThresholds] = useState<AlertThreshold[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ thresholdCount: string; windowMinutes: string }>({
    thresholdCount: "",
    windowMinutes: "",
  });

  const loadThresholds = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/alert-thresholds");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to load alert thresholds");
        return;
      }
      setThresholds(data.thresholds);
    } catch {
      setError("Failed to load alert thresholds");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadThresholds();
  }, [loadThresholds]);

  function startEditing(threshold: AlertThreshold) {
    setEditingKey(threshold.key);
    setDraft({
      thresholdCount: String(threshold.thresholdCount),
      windowMinutes: String(threshold.windowMinutes),
    });
  }

  async function saveThreshold(key: string) {
    const thresholdCount = Number(draft.thresholdCount);
    const windowMinutes = Number(draft.windowMinutes);
    if (!Number.isInteger(thresholdCount) || thresholdCount < 1) {
      setError("Threshold count must be a positive integer");
      return;
    }
    if (!Number.isInteger(windowMinutes) || windowMinutes < 1) {
      setError("Window (minutes) must be a positive integer");
      return;
    }

    setSavingKey(key);
    setError(null);
    try {
      const res = await fetch("/api/admin/alert-thresholds", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, thresholdCount, windowMinutes }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to update alert threshold");
        return;
      }
      setThresholds((prev) =>
        prev ? prev.map((t) => (t.key === key ? data.threshold : t)) : prev
      );
      setEditingKey(null);
    } catch {
      setError("Failed to update alert threshold");
    } finally {
      setSavingKey(null);
    }
  }

  async function toggleEnabled(threshold: AlertThreshold) {
    setSavingKey(threshold.key);
    setError(null);
    try {
      const res = await fetch("/api/admin/alert-thresholds", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: threshold.key, enabled: !threshold.enabled }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to update alert threshold");
        return;
      }
      setThresholds((prev) =>
        prev ? prev.map((t) => (t.key === threshold.key ? data.threshold : t)) : prev
      );
    } catch {
      setError("Failed to update alert threshold");
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="px-4 py-3 text-sm font-semibold text-gray-800">Monitoring Alert Thresholds</div>

      <div className="border-t border-gray-100 px-4 py-4">
        {error ? (
          <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
            {error}
          </div>
        ) : null}

        {isLoading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : thresholds && thresholds.length > 0 ? (
          <ul className="divide-y divide-gray-100">
            {thresholds.map((threshold) => (
              <li key={threshold.key} className="flex items-center justify-between gap-3 py-2.5">
                <div>
                  <p className="text-sm text-gray-800">{threshold.label}</p>
                  {editingKey === threshold.key ? (
                    <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                      <input
                        type="number"
                        min={1}
                        value={draft.thresholdCount}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, thresholdCount: e.target.value }))
                        }
                        className="w-16 rounded border border-gray-200 px-1.5 py-0.5"
                      />
                      <span>failures per</span>
                      <input
                        type="number"
                        min={1}
                        value={draft.windowMinutes}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, windowMinutes: e.target.value }))
                        }
                        className="w-16 rounded border border-gray-200 px-1.5 py-0.5"
                      />
                      <span>min</span>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500">
                      {threshold.thresholdCount} failures per {threshold.windowMinutes} min
                      {threshold.enabled ? "" : " — disabled"}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {editingKey === threshold.key ? (
                    <>
                      <Button
                        className="h-7 px-2 text-xs"
                        onClick={() => saveThreshold(threshold.key)}
                        disabled={savingKey === threshold.key}
                      >
                        {savingKey === threshold.key ? "Saving…" : "Save"}
                      </Button>
                      <Button
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        onClick={() => setEditingKey(null)}
                        disabled={savingKey === threshold.key}
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        onClick={() => toggleEnabled(threshold)}
                        disabled={savingKey === threshold.key}
                      >
                        {threshold.enabled ? "Disable" : "Enable"}
                      </Button>
                      <Button
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        onClick={() => startEditing(threshold)}
                        disabled={savingKey === threshold.key}
                      >
                        Edit
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-500">No alert thresholds found.</p>
        )}
      </div>
    </div>
  );
}
