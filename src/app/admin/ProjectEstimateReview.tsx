"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/frontend/components/ui/button";
import { EditIcon } from "@/frontend/components/icons";
import type { SerializedProject } from "./AdminDashboardClient";
import { isTieredEstimate, DEFAULT_PRICING_TIER, type AnyRefinedEstimate } from "@/backend/services/pricingTiers";
import type { RefinedEstimateLineItem } from "@/backend/services/refinedEstimate";

interface ProjectEstimateReviewProps {
  project: SerializedProject;
}

// placeholder markup for manual recalculation until this uses real tiered pricing (see PRICING_TIER_CONFIG)
const PROVISIONAL_MARKUP_MULTIPLIER = 1.2;

interface LineItem {
  description: string;
  quantity: number;
  materialTotal: number;
  laborTotal: number;
}

export function ProjectEstimateReview({ project }: ProjectEstimateReviewProps) {
  const router = useRouter();

  // grab the correct estimate structure since it can be either tiered or flat
  const rawRefinedEstimate = project.quote?.refinedEstimate as AnyRefinedEstimate | null | undefined;
  const initialEstimate = isTieredEstimate(rawRefinedEstimate)
    ? rawRefinedEstimate.tiers[rawRefinedEstimate.selectedTier ?? DEFAULT_PRICING_TIER]
    : rawRefinedEstimate;

  const [isEditing, setIsEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const [lineItems, setLineItems] = useState<LineItem[]>(
    initialEstimate?.lineItems ?? []
  );
  const [subtotal, setSubtotal] = useState<number>(
    initialEstimate?.subtotal ?? parseFloat(project.quote?.subtotal ?? "0")
  );
  const [total, setTotal] = useState<number>(
    initialEstimate?.total ?? parseFloat(project.quote?.total ?? "0")
  );

  const [modificationScope, setModificationScope] = useState<string[]>(
    project.modificationType ? [project.modificationType] : []
  );

  const [eligibilityDecision, setEligibilityDecision] = useState<string>(
    project.eligibility?.overallDecision ?? "MANUAL_REVIEW"
  );
  const [overrideReason, setOverrideReason] = useState("");

  if (!project.quote) {
    return null;
  }

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
    setTotal(newSubtotal * PROVISIONAL_MARKUP_MULTIPLIER);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const payload = {
        modificationItems: modificationScope,
        reason: overrideReason,
        pricing: {
          lineItems,
          subtotal,
          total,
        },
        grantEligibilityOverride: eligibilityDecision,
      };

      const res = await fetch(`/api/admin/projects/${project.id}/modification-override`, {
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
          AI Estimate Review & Override
        </h4>
        {!isEditing && (
          <Button size="sm" variant="outline" onClick={() => setIsEditing(true)}>
            Edit Estimate
          </Button>
        )}
      </div>

      {!isEditing ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gray-50 p-3 rounded border">
              <p className="text-xs font-semibold text-gray-500 mb-1">AI Generated Total</p>
              <p className="text-lg font-bold">${parseFloat(project.quote.total).toFixed(2)}</p>
            </div>
            <div className="bg-gray-50 p-3 rounded border">
              <p className="text-xs font-semibold text-gray-500 mb-1">AI Grant Eligibility</p>
              <p className="text-sm font-medium">{project.eligibility?.overallDecision || "N/A"}</p>
            </div>
          </div>
          {initialEstimate?.lineItems && (
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
                  {initialEstimate.lineItems.map((item: RefinedEstimateLineItem, i: number) => (
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
            <input
              type="text"
              className="w-full border rounded p-2 text-base sm:text-sm"
              value={modificationScope.join(", ")}
              onChange={(e) => setModificationScope(e.target.value.split(",").map(s => s.trim()))}
              placeholder="e.g. GRAB_BARS, RAMPS"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-gray-700">Grant Eligibility Override</label>
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
            <label className="text-xs font-semibold text-gray-700">Reason for Override</label>
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
            <Button onClick={() => setShowConfirm(true)}>Review & Submit</Button>
          </div>
        </div>
      )}

      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-lg space-y-4">
            <h2 className="text-lg font-bold text-gray-900">Confirm Estimate Override</h2>
            <div className="text-sm text-gray-600 space-y-3">
              <p>You are about to override the AI-generated estimate for this project.</p>
              <div className="grid grid-cols-2 gap-2 bg-gray-50 p-3 rounded border">
                <div>
                  <p className="font-semibold text-xs text-gray-500">Original Total</p>
                  <p className="font-bold line-through">${parseFloat(project.quote.total).toFixed(2)}</p>
                </div>
                <div>
                  <p className="font-semibold text-xs text-indigo-600">New Total</p>
                  <p className="font-bold text-indigo-700">${total.toFixed(2)}</p>
                </div>
              </div>
              <p>This action will record an audit trail and update the client's visible estimate.</p>
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
