"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/frontend/components/ui/button";
import { EditIcon } from "@/frontend/components/icons";
import type { SerializedProject } from "./AdminDashboardClient";
import { photoModificationOptions } from "./AdminDashboardClient";

interface ProjectEstimateReviewProps {
  project: SerializedProject;
}

const GRANT_SCOPE_OPTIONS = ["MUNICIPAL", "PROVINCIAL", "NATIONAL"] as const;
const BINARY_DECISIONS = ["ELIGIBLE", "INELIGIBLE"] as const;

interface LineItem {
  description: string;
  quantity: number;
  materialTotal: number;
  laborTotal: number;
}

interface EditableGrant {
  grantId: string;
  title: string;
  scope: string;
  jurisdiction: string;
  decision: string;
  source: "ai" | "admin_added";
  note?: string | null;
}

let localGrantIdCounter = 0;
function nextLocalGrantId(): string {
  localGrantIdCounter += 1;
  return `local-${localGrantIdCounter}`;
}

export function ProjectEstimateReview({ project }: ProjectEstimateReviewProps) {
  const router = useRouter();

  const [isEditing, setIsEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const [lineItems, setLineItems] = useState<LineItem[]>(project.quote?.effectiveLineItems ?? []);
  const [subtotal, setSubtotal] = useState<number>(parseFloat(project.quote?.subtotal ?? "0"));
  const [total, setTotal] = useState<number>(parseFloat(project.quote?.total ?? "0"));

  const [scopeDraft, setScopeDraft] = useState<Record<string, string[]>>({});
  const [eligibilityDecision, setEligibilityDecision] = useState<string>(
    project.eligibility?.overallDecision ?? "MANUAL_REVIEW"
  );
  const [grants, setGrants] = useState<EditableGrant[]>(
    (project.eligibility?.discoveredGrants ?? []).map((g) => ({
      grantId: g.grantId,
      title: g.title,
      scope: g.scope,
      jurisdiction: g.jurisdiction ?? "",
      decision: g.decision,
      source: g.source ?? "ai",
      note: g.note ?? null,
    }))
  );
  const [newGrantTitle, setNewGrantTitle] = useState("");
  const [newGrantScope, setNewGrantScope] = useState<string>(GRANT_SCOPE_OPTIONS[0]);
  const [newGrantJurisdiction, setNewGrantJurisdiction] = useState("");
  const [newGrantDecision, setNewGrantDecision] = useState<string>("ELIGIBLE");
  const [newGrantNote, setNewGrantNote] = useState("");

  const [overrideReason, setOverrideReason] = useState("");

  if (!project.quote) {
    return null;
  }

  function startEditing() {
    const seed: Record<string, string[]> = {};
    for (const photo of project.photos ?? []) {
      seed[photo.id] = [...photo.declaredModificationCodes];
    }
    setScopeDraft(seed);
    setLineItems(project.quote!.effectiveLineItems ?? []);
    setSubtotal(parseFloat(project.quote!.subtotal));
    setTotal(parseFloat(project.quote!.total));
    setEligibilityDecision(project.eligibility?.overallDecision ?? "MANUAL_REVIEW");
    setGrants(
      (project.eligibility?.discoveredGrants ?? []).map((g) => ({
        grantId: g.grantId,
        title: g.title,
        scope: g.scope,
        jurisdiction: g.jurisdiction ?? "",
        decision: g.decision,
        source: g.source ?? "ai",
        note: g.note ?? null,
      }))
    );
    setOverrideReason("");
    setErrorMsg(null);
    setIsEditing(true);
  }

  function toggleScopeCode(photoId: string, code: string, checked: boolean) {
    setScopeDraft((prev) => {
      const current = prev[photoId] ?? [];
      const next = checked ? Array.from(new Set([...current, code])) : current.filter((c) => c !== code);
      return { ...prev, [photoId]: next };
    });
  }

  const scopeHasUntaggedPhoto = Object.values(scopeDraft).some((codes) => codes.length === 0);

  const handleLineItemChange = <K extends keyof LineItem>(index: number, field: K, value: LineItem[K]) => {
    const newItems = [...lineItems];
    newItems[index] = { ...newItems[index], [field]: value };
    setLineItems(newItems);
  };

  const addLineItem = () => {
    setLineItems([...lineItems, { description: "", quantity: 1, materialTotal: 0, laborTotal: 0 }]);
  };

  const removeLineItem = (index: number) => {
    setLineItems(lineItems.filter((_, i) => i !== index));
  };

  const calculateTotals = () => {
    const newSubtotal = lineItems.reduce((acc, item) => {
      return acc + (item.materialTotal || 0) + (item.laborTotal || 0);
    }, 0);
    setSubtotal(newSubtotal);
    setTotal(newSubtotal);
  };

  function removeGrant(grantId: string) {
    setGrants((prev) => prev.filter((g) => g.grantId !== grantId));
  }

  function setGrantDecision(grantId: string, decision: string) {
    setGrants((prev) => prev.map((g) => (g.grantId === grantId ? { ...g, decision } : g)));
  }

  function addManualGrant() {
    if (!newGrantTitle.trim() || !newGrantJurisdiction.trim()) return;
    setGrants((prev) => [
      ...prev,
      {
        grantId: nextLocalGrantId(),
        title: newGrantTitle.trim(),
        scope: newGrantScope,
        jurisdiction: newGrantJurisdiction.trim(),
        decision: newGrantDecision,
        source: "admin_added",
        note: newGrantNote.trim() || null,
      },
    ]);
    setNewGrantTitle("");
    setNewGrantJurisdiction("");
    setNewGrantNote("");
    setNewGrantDecision("ELIGIBLE");
  }

  const addedGrantsMissingFields = grants.some(
    (g) => g.source === "admin_added" && (!g.title.trim() || !g.jurisdiction.trim())
  );
  const canSubmit = overrideReason.trim().length > 0 && !scopeHasUntaggedPhoto && !addedGrantsMissingFields;

  const handleSubmit = async () => {
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const originalAiGrantIds = new Set(project.eligibility?.allGrantIds ?? []);
      const currentAiGrants = grants.filter((g) => g.source === "ai");
      const currentAiGrantIds = new Set(currentAiGrants.map((g) => g.grantId));
      const removedGrantIds = Array.from(originalAiGrantIds).filter((id) => !currentAiGrantIds.has(id));
      const decisionOverrides = currentAiGrants
        .filter((g) => (BINARY_DECISIONS as readonly string[]).includes(g.decision))
        .map((g) => ({ grantId: g.grantId, decision: g.decision }));
      const addedGrants = grants
        .filter((g) => g.source === "admin_added")
        .map((g) => ({
          title: g.title.trim(),
          scope: g.scope,
          jurisdiction: g.jurisdiction.trim(),
          decision: g.decision,
          note: g.note ?? undefined,
        }));

      const payload = {
        photoModifications: Object.entries(scopeDraft).map(([photoId, declaredModificationCodes]) => ({
          photoId,
          declaredModificationCodes,
        })),
        pricing: { lineItems, subtotal, total },
        eligibilityDecision,
        grantChanges: { removedGrantIds, decisionOverrides, addedGrants },
        reason: overrideReason.trim(),
      };

      const res = await fetch(`/api/admin/projects/${project.id}/quote-override`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to submit override");
      }

      setShowConfirm(false);
      setIsEditing(false);
      router.refresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to submit override");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm space-y-4 mt-5">
      <div className="flex justify-between items-center">
        <h4 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
          <EditIcon size={16} strokeWidth={1.5} className="text-indigo-500" />
          Estimate Review & Override
        </h4>
        {!isEditing && (
          <Button size="sm" variant="outline" onClick={startEditing}>
            Edit Estimate
          </Button>
        )}
      </div>

      {!isEditing ? (
        <div className="space-y-4">
          {project.quote.override && (
            <div className="rounded border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
              <p className="font-semibold">Manually overridden</p>
              <p>{project.quote.override.reason}</p>
              <p className="text-amber-600 mt-0.5">
                Last updated {new Date(project.quote.override.overriddenAt).toLocaleString()}
              </p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gray-50 p-3 rounded border">
              <p className="text-xs font-semibold text-gray-500 mb-1">Total</p>
              <p className="text-lg font-bold">${parseFloat(project.quote.total).toFixed(2)}</p>
            </div>
            <div className="bg-gray-50 p-3 rounded border">
              <p className="text-xs font-semibold text-gray-500 mb-1">Grant Eligibility</p>
              <p className="text-sm font-medium">{project.eligibility?.overallDecision || "N/A"}</p>
            </div>
          </div>
          {lineItems.length > 0 && (
            <div className="border rounded overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-50 text-xs text-gray-500 border-b">
                  <tr>
                    <th className="px-3 py-2 font-medium">Description</th>
                    <th className="px-3 py-2 font-medium">Qty</th>
                    <th className="px-3 py-2 font-medium">Material</th>
                    <th className="px-3 py-2 font-medium">Labor</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {lineItems.map((item, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-3 py-2">{item.description}</td>
                      <td className="px-3 py-2">{item.quantity}</td>
                      <td className="px-3 py-2">${item.materialTotal}</td>
                      <td className="px-3 py-2">${item.laborTotal}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-5 border-t pt-4">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-gray-700">Modification Scope</label>
            <div className="space-y-3">
              {(project.photos ?? []).map((photo) => (
                <div key={photo.id} className="rounded border p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photo.url} alt="" className="h-10 w-10 rounded object-cover border" />
                    <span className="text-xs text-gray-500">Photo {photo.id.slice(0, 8)}</span>
                  </div>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {photoModificationOptions.map(({ code, label }) => (
                      <label key={code} className="flex items-center gap-2 rounded border border-input px-2 py-1 text-xs">
                        <input
                          type="checkbox"
                          checked={(scopeDraft[photo.id] ?? []).includes(code)}
                          onChange={(e) => toggleScopeCode(photo.id, code, e.target.checked)}
                          className="rounded border-input"
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  {(scopeDraft[photo.id] ?? []).length === 0 && (
                    <p className="text-xs text-destructive" role="alert">
                      Tag at least one modification for this photo
                    </p>
                  )}
                </div>
              ))}
              {(project.photos ?? []).length === 0 && (
                <p className="text-xs text-gray-400 italic">No photos on this project.</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-gray-700">Overall Grant Eligibility</label>
            <select
              className="w-full border rounded p-2 text-base sm:text-sm"
              value={eligibilityDecision}
              onChange={(e) => setEligibilityDecision(e.target.value)}
            >
              <option value="ELIGIBLE">Eligible</option>
              <option value="INELIGIBLE">Ineligible</option>
              <option value="MANUAL_REVIEW">Manual Review</option>
              <option value="NEEDS_MORE_INFO">Needs More Info</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-gray-700">Discovered Grants</label>
            <div className="space-y-2">
              {grants.map((grant) => (
                <div key={grant.grantId} className="rounded border p-2.5 space-y-1.5 bg-gray-50">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-gray-900 truncate">{grant.title || "(untitled)"}</p>
                      <p className="text-[11px] text-gray-500">
                        {grant.scope} · {grant.jurisdiction || "unspecified"} ·{" "}
                        <span className={grant.source === "admin_added" ? "text-indigo-600" : "text-gray-500"}>
                          {grant.source === "admin_added" ? "Added by admin" : "AI discovered"}
                        </span>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeGrant(grant.grantId)}
                      aria-label="Remove grant"
                      className="text-red-500 hover:text-red-700 font-bold h-8 w-8 flex items-center justify-center shrink-0"
                    >
                      ×
                    </button>
                  </div>

                  {grant.source === "admin_added" ? (
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      <input
                        type="text"
                        className="border rounded p-1.5 text-xs"
                        value={grant.title}
                        placeholder="Title"
                        onChange={(e) =>
                          setGrants((prev) =>
                            prev.map((g) => (g.grantId === grant.grantId ? { ...g, title: e.target.value } : g))
                          )
                        }
                      />
                      <input
                        type="text"
                        className="border rounded p-1.5 text-xs"
                        value={grant.jurisdiction}
                        placeholder="Jurisdiction"
                        onChange={(e) =>
                          setGrants((prev) =>
                            prev.map((g) => (g.grantId === grant.grantId ? { ...g, jurisdiction: e.target.value } : g))
                          )
                        }
                      />
                      <select
                        className="border rounded p-1.5 text-xs"
                        value={grant.scope}
                        onChange={(e) =>
                          setGrants((prev) =>
                            prev.map((g) => (g.grantId === grant.grantId ? { ...g, scope: e.target.value } : g))
                          )
                        }
                      >
                        {GRANT_SCOPE_OPTIONS.map((scope) => (
                          <option key={scope} value={scope}>
                            {scope}
                          </option>
                        ))}
                      </select>
                      <select
                        className="border rounded p-1.5 text-xs"
                        value={grant.decision}
                        onChange={(e) => setGrantDecision(grant.grantId, e.target.value)}
                      >
                        <option value="ELIGIBLE">Eligible</option>
                        <option value="INELIGIBLE">Ineligible</option>
                      </select>
                    </div>
                  ) : (
                    <select
                      className="border rounded p-1.5 text-xs"
                      value={grant.decision}
                      onChange={(e) => setGrantDecision(grant.grantId, e.target.value)}
                    >
                      {!(BINARY_DECISIONS as readonly string[]).includes(grant.decision) && (
                        <option value={grant.decision}>{grant.decision} (AI, unchanged)</option>
                      )}
                      <option value="ELIGIBLE">Eligible</option>
                      <option value="INELIGIBLE">Ineligible</option>
                    </select>
                  )}
                </div>
              ))}
              {grants.length === 0 && <p className="text-xs text-gray-400 italic">No grants listed.</p>}
            </div>

            <div className="rounded border border-dashed p-2.5 space-y-1.5">
              <p className="text-[11px] font-semibold text-gray-600">Add a grant</p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                <input
                  type="text"
                  className="border rounded p-1.5 text-xs"
                  value={newGrantTitle}
                  placeholder="Title"
                  onChange={(e) => setNewGrantTitle(e.target.value)}
                />
                <input
                  type="text"
                  className="border rounded p-1.5 text-xs"
                  value={newGrantJurisdiction}
                  placeholder="Jurisdiction"
                  onChange={(e) => setNewGrantJurisdiction(e.target.value)}
                />
                <select
                  className="border rounded p-1.5 text-xs"
                  value={newGrantScope}
                  onChange={(e) => setNewGrantScope(e.target.value)}
                >
                  {GRANT_SCOPE_OPTIONS.map((scope) => (
                    <option key={scope} value={scope}>
                      {scope}
                    </option>
                  ))}
                </select>
                <select
                  className="border rounded p-1.5 text-xs"
                  value={newGrantDecision}
                  onChange={(e) => setNewGrantDecision(e.target.value)}
                >
                  <option value="ELIGIBLE">Eligible</option>
                  <option value="INELIGIBLE">Ineligible</option>
                </select>
                <input
                  type="text"
                  className="border rounded p-1.5 text-xs sm:col-span-2"
                  value={newGrantNote}
                  placeholder="Note (optional)"
                  onChange={(e) => setNewGrantNote(e.target.value)}
                />
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="text-xs"
                disabled={!newGrantTitle.trim() || !newGrantJurisdiction.trim()}
                onClick={addManualGrant}
              >
                + Add grant
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-xs font-semibold text-gray-700">Line Items</label>
              <Button size="sm" variant="ghost" onClick={addLineItem}>+ Add Item</Button>
            </div>
            <div className="space-y-2">
              {lineItems.map((item, i) => (
                <div key={i} className="flex items-center gap-2 bg-gray-50 p-2 rounded border">
                  <input
                    type="text"
                    className="flex-1 border rounded p-1.5 text-base sm:text-sm"
                    value={item.description}
                    onChange={(e) => handleLineItemChange(i, "description", e.target.value)}
                    placeholder="Description"
                  />
                  <input
                    type="number"
                    className="w-20 border rounded p-1.5 text-base sm:text-sm"
                    value={item.quantity}
                    onChange={(e) => handleLineItemChange(i, "quantity", Number(e.target.value))}
                    placeholder="Qty"
                  />
                  <input
                    type="number"
                    className="w-24 border rounded p-1.5 text-base sm:text-sm"
                    value={item.materialTotal}
                    onChange={(e) => handleLineItemChange(i, "materialTotal", Number(e.target.value))}
                    placeholder="Material $"
                  />
                  <input
                    type="number"
                    className="w-24 border rounded p-1.5 text-base sm:text-sm"
                    value={item.laborTotal}
                    onChange={(e) => handleLineItemChange(i, "laborTotal", Number(e.target.value))}
                    placeholder="Labor $"
                  />
                  <button
                    type="button"
                    onClick={() => removeLineItem(i)}
                    aria-label="Remove line item"
                    className="text-red-500 hover:text-red-700 font-bold h-11 w-11 flex items-center justify-center shrink-0"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button size="sm" variant="outline" onClick={calculateTotals}>Recalculate Totals</Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-gray-700">Subtotal Override ($)</label>
              <input
                type="number"
                className="w-full border rounded p-2 text-base sm:text-sm"
                value={subtotal}
                onChange={(e) => setSubtotal(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700">Total Override ($)</label>
              <input
                type="number"
                className="w-full border rounded p-2 text-base sm:text-sm"
                value={total}
                onChange={(e) => setTotal(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-gray-700">Reason for Override (required)</label>
            <textarea
              className="w-full border rounded p-2 text-base sm:text-sm"
              rows={3}
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              placeholder="Explain why this estimate was manually adjusted..."
            />
          </div>

          {errorMsg && <p className="text-sm text-red-600">{errorMsg}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setIsEditing(false)}>Cancel</Button>
            <Button disabled={!canSubmit} onClick={() => setShowConfirm(true)}>Review & Submit</Button>
          </div>
        </div>
      )}

      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-lg space-y-4">
            <h2 className="text-lg font-bold text-gray-900">Confirm Estimate Override</h2>
            <div className="text-sm text-gray-600 space-y-3">
              <p>You are about to override this project&apos;s estimate.</p>
              <div className="grid grid-cols-2 gap-2 bg-gray-50 p-3 rounded border">
                <div>
                  <p className="font-semibold text-xs text-gray-500">Current Total</p>
                  <p className="font-bold line-through">${parseFloat(project.quote.total).toFixed(2)}</p>
                </div>
                <div>
                  <p className="font-semibold text-xs text-indigo-600">New Total</p>
                  <p className="font-bold text-indigo-700">${total.toFixed(2)}</p>
                </div>
              </div>
              <p>This action will record an audit trail and update the client&apos;s visible estimate.</p>
            </div>
            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button variant="outline" onClick={() => setShowConfirm(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? "Submitting..." : "Confirm Override"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
