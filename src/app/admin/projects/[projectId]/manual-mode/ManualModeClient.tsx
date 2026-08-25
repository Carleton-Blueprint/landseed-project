"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/frontend/components/ui/button";
import { Input } from "@/frontend/components/ui/input";

export interface ManualModePricingItem {
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface ManualModeSubmissionData {
  modificationType: string;
  scope: string;
  notes: string | null;
  pricingItems: ManualModePricingItem[];
  subtotal: number;
  total: number;
  status: "DRAFT" | "READY" | "PACKAGE_GENERATED";
}

export interface ManualModeDocumentData {
  id: string;
  fileName: string;
  documentType: string;
  label: string | null;
  virusScanStatus: string;
  createdAt: string;
}

export interface ManualModePhotoData {
  id: string;
  url: string;
  virusScanStatus: string;
  createdAt: string;
}

export interface ManualModeInitialData {
  projectId: string;
  address: string;
  clientName: string | null;
  clientEmail: string | null;
  status: string;
  hasExistingAiQuote: boolean;
  submission: ManualModeSubmissionData | null;
  documents: ManualModeDocumentData[];
  photos: ManualModePhotoData[];
}

function fmtMoney(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const SCAN_STATUS_STYLES: Record<string, string> = {
  pending: "bg-gray-100 text-gray-700 border-gray-300",
  clean: "bg-emerald-100 text-emerald-700 border-emerald-300",
  infected: "bg-red-100 text-red-700 border-red-300",
  failed: "bg-red-100 text-red-700 border-red-300",
};

const DOCUMENT_TYPE_LABEL: Record<string, string> = {
  MANUAL_MODE_DRAWING: "Drawing",
  VENDOR_QUOTE: "Vendor Quote",
};

export function ManualModeClient({ initialData }: { initialData: ManualModeInitialData }) {
  const router = useRouter();
  const { projectId, submission: initialSubmission, documents, photos } = initialData;
  const locked = initialSubmission?.status === "PACKAGE_GENERATED";

  const [modificationType, setModificationType] = useState(initialSubmission?.modificationType ?? "");
  const [scope, setScope] = useState(initialSubmission?.scope ?? "");
  const [notes, setNotes] = useState(initialSubmission?.notes ?? "");
  const [pricingItems, setPricingItems] = useState<ManualModePricingItem[]>(
    initialSubmission?.pricingItems?.length
      ? initialSubmission.pricingItems
      : [{ description: "", quantity: 1, unitPrice: 0 }]
  );
  const [submissionStatus, setSubmissionStatus] = useState(initialSubmission?.status ?? null);

  const [saving, setSaving] = useState<"draft" | "ready" | null>(null);
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [packageResult, setPackageResult] = useState<{
    quoteId: string;
    grantDocumentKey: string | null;
    builderTrendTransferId: string | null;
    clientNotified: boolean;
  } | null>(null);

  const [uploadDocumentType, setUploadDocumentType] = useState<"MANUAL_MODE_DRAWING" | "VENDOR_QUOTE">(
    "MANUAL_MODE_DRAWING"
  );
  const [uploadLabel, setUploadLabel] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const [selectedPhoto, setSelectedPhoto] = useState<File | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const computedTotal = useMemo(
    () =>
      pricingItems.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0), 0),
    [pricingItems]
  );

  function updatePricingItem(index: number, patch: Partial<ManualModePricingItem>) {
    setPricingItems((items) => items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function addPricingItem() {
    setPricingItems((items) => [...items, { description: "", quantity: 1, unitPrice: 0 }]);
  }

  function removePricingItem(index: number) {
    setPricingItems((items) => (items.length > 1 ? items.filter((_, i) => i !== index) : items));
  }

  async function handleSave(markReady: boolean) {
    setErrorMessage(null);
    setSuccessMessage(null);
    setSaving(markReady ? "ready" : "draft");

    try {
      const validItems = pricingItems
        .filter((item) => item.description.trim().length > 0)
        .map((item) => ({
          description: item.description.trim(),
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
        }));

      const response = await fetch(`/api/admin/projects/${projectId}/manual-mode`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modificationType,
          scope,
          notes: notes.trim() ? notes : null,
          pricingItems: validItems,
          markReady,
        }),
      });

      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to save manual mode submission");
      }

      setSubmissionStatus(body.submission.status);
      setSuccessMessage(markReady ? "Marked ready for output package generation." : "Draft saved.");
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to save manual mode submission");
    } finally {
      setSaving(null);
    }
  }

  async function handleUpload() {
    if (!selectedFile) {
      setErrorMessage("Choose a file to upload first.");
      return;
    }

    setErrorMessage(null);
    setSuccessMessage(null);
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("documentType", uploadDocumentType);
      if (uploadLabel.trim()) formData.append("label", uploadLabel.trim());

      const response = await fetch(`/api/admin/projects/${projectId}/manual-mode/documents`, {
        method: "POST",
        body: formData,
      });

      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to upload document");
      }

      setSuccessMessage(`Uploaded ${selectedFile.name}. Virus scan in progress.`);
      setSelectedFile(null);
      setUploadLabel("");
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to upload document");
    } finally {
      setUploading(false);
    }
  }

  async function handleUploadPhoto() {
    if (!selectedPhoto) {
      setErrorMessage("Choose a photo to upload first.");
      return;
    }

    setErrorMessage(null);
    setSuccessMessage(null);
    setUploadingPhoto(true);

    try {
      const formData = new FormData();
      formData.append("file", selectedPhoto);

      const response = await fetch(`/api/admin/projects/${projectId}/manual-mode/photos`, {
        method: "POST",
        body: formData,
      });

      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to upload photo");
      }

      setSuccessMessage(`Uploaded ${selectedPhoto.name}. Virus scan in progress.`);
      setSelectedPhoto(null);
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to upload photo");
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function handleGeneratePackage() {
    setErrorMessage(null);
    setSuccessMessage(null);
    setGenerating(true);

    try {
      const response = await fetch(`/api/admin/projects/${projectId}/manual-mode/generate-package`, {
        method: "POST",
      });

      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to generate output package");
      }

      setPackageResult(body);
      setSubmissionStatus("PACKAGE_GENERATED");
      setSuccessMessage("Output package generated.");
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to generate output package");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <Link href="/admin" className="text-sm text-blue-600 hover:underline">
            &larr; Back to Admin Dashboard
          </Link>
          <h1 className="mt-2 text-3xl font-bold text-gray-900">Manual Mode</h1>
          <p className="mt-1 text-gray-600">{initialData.address}</p>
          <p className="text-sm text-gray-500">
            {initialData.clientName ?? "Unknown client"} ({initialData.clientEmail ?? "no email"}) &middot; Status:{" "}
            {initialData.status.replace(/_/g, " ")}
          </p>
        </div>

        {initialData.hasExistingAiQuote && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
            This project already has an AI-generated quote. Switching to manual mode won&apos;t remove it, but the
            output package you generate here will use the manually-entered pricing below instead.
          </div>
        )}

        {errorMessage && (
          <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">{errorMessage}</div>
        )}
        {successMessage && (
          <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-700">
            {successMessage}
          </div>
        )}

        {locked && (
          <div className="rounded-lg border border-blue-300 bg-blue-50 p-4 text-sm text-blue-800">
            This submission&apos;s output package has already been generated. It can no longer be edited.
          </div>
        )}

        {packageResult && (
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm space-y-1 text-sm">
            <p className="font-semibold text-gray-900">Output package generated</p>
            <p className="text-gray-600">Quote ID: {packageResult.quoteId}</p>
            <p className="text-gray-600">
              Grant document: {packageResult.grantDocumentKey ?? "generation failed — check audit log"}
            </p>
            <p className="text-gray-600">
              BuilderTrend work order:{" "}
              {packageResult.builderTrendTransferId ?? "creation failed — check audit log"}
            </p>
            <p className={packageResult.clientNotified ? "text-gray-600" : "text-amber-600"}>
              Client notified: {packageResult.clientNotified ? "yes" : "no — check audit log"}
            </p>
          </div>
        )}

        {/* Modification type / scope */}
        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Modification Details</h2>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Modification Type</label>
            <Input
              value={modificationType}
              onChange={(e) => setModificationType(e.target.value)}
              disabled={locked}
              placeholder="e.g. Walk-in shower conversion"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Scope</label>
            <textarea
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-24 disabled:cursor-not-allowed disabled:opacity-50"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              disabled={locked}
              placeholder="Describe the work to be done in detail."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
            <textarea
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-16 disabled:cursor-not-allowed disabled:opacity-50"
              value={notes ?? ""}
              onChange={(e) => setNotes(e.target.value)}
              disabled={locked}
            />
          </div>
        </section>

        {/* Pricing */}
        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Pricing</h2>

          <div className="space-y-2">
            <div className="flex gap-2 items-center text-xs font-medium text-gray-500">
              <span className="flex-1">Description</span>
              <span className="w-24" title="Number of units of this item">
                Qty
              </span>
              <span className="w-32" title="Price per single unit, before quantity is applied">
                Unit Price ($)
              </span>
              <span className="w-[74px]" aria-hidden="true" />
            </div>
            {pricingItems.map((item, index) => (
              <div key={index} className="flex gap-2 items-start">
                <Input
                  className="flex-1"
                  value={item.description}
                  onChange={(e) => updatePricingItem(index, { description: e.target.value })}
                  disabled={locked}
                  placeholder="Item description"
                />
                <Input
                  type="number"
                  className="w-24"
                  value={item.quantity}
                  min={0}
                  onChange={(e) => updatePricingItem(index, { quantity: Number(e.target.value) })}
                  disabled={locked}
                  placeholder="Qty"
                  title="Number of units of this item"
                />
                <Input
                  type="number"
                  className="w-32"
                  value={item.unitPrice}
                  min={0}
                  step="0.01"
                  onChange={(e) => updatePricingItem(index, { unitPrice: Number(e.target.value) })}
                  disabled={locked}
                  placeholder="Unit price"
                  title="Price per single unit, before quantity is applied"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => removePricingItem(index)}
                  disabled={locked || pricingItems.length === 1}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500">
            Line total = Qty × Unit Price. The Total below is the sum of all line totals.
          </p>

          {!locked && (
            <Button type="button" variant="outline" size="sm" onClick={addPricingItem}>
              + Add Item
            </Button>
          )}

          <div className="flex justify-end border-t pt-3">
            <p className="text-lg font-bold text-gray-900">Total: {fmtMoney(computedTotal)}</p>
          </div>

          {!locked && (
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => handleSave(false)} disabled={saving !== null}>
                {saving === "draft" ? "Saving..." : "Save Draft"}
              </Button>
              <Button onClick={() => handleSave(true)} disabled={saving !== null}>
                {saving === "ready" ? "Saving..." : "Mark Ready"}
              </Button>
            </div>
          )}
        </section>

        {/* Drawings & vendor quotes */}
        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Drawings & Vendor Quotes</h2>

          {documents.length === 0 ? (
            <p className="text-sm text-gray-500 italic">No drawings or vendor quotes attached yet.</p>
          ) : (
            <ul className="space-y-2">
              {documents.map((doc) => (
                <li
                  key={doc.id}
                  className="flex items-center justify-between rounded-md border bg-gray-50 px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-gray-800">
                      {doc.fileName}
                      {doc.label ? ` — ${doc.label}` : ""}
                    </p>
                    <p className="text-xs text-gray-500">
                      {DOCUMENT_TYPE_LABEL[doc.documentType] ?? doc.documentType} &middot;{" "}
                      {new Date(doc.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                      SCAN_STATUS_STYLES[doc.virusScanStatus] ?? "bg-gray-100 text-gray-700 border-gray-300"
                    }`}
                  >
                    {doc.virusScanStatus}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {!locked && (
            <div className="flex flex-wrap items-end gap-2 border-t pt-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Type</label>
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={uploadDocumentType}
                  onChange={(e) => setUploadDocumentType(e.target.value as "MANUAL_MODE_DRAWING" | "VENDOR_QUOTE")}
                >
                  <option value="MANUAL_MODE_DRAWING">Drawing</option>
                  <option value="VENDOR_QUOTE">Vendor Quote</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Label (optional)</label>
                <Input
                  className="w-48"
                  value={uploadLabel}
                  onChange={(e) => setUploadLabel(e.target.value)}
                  placeholder="e.g. Bathroom layout v2"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">File</label>
                <div className="flex h-10 items-center">
                  <input
                    type="file"
                    onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                    className="text-sm text-gray-600 file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-input file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium file:text-gray-700 file:shadow-sm file:transition-colors hover:file:bg-gray-50"
                  />
                </div>
              </div>
              <Button type="button" onClick={handleUpload} disabled={uploading}>
                {uploading ? "Uploading..." : "Upload"}
              </Button>
            </div>
          )}
        </section>

        {/* Photos */}
        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Photos</h2>
          <p className="text-sm text-gray-600">
            Reference photos for staff use. These are never sent through AI analysis or image generation.
          </p>

          {photos.length === 0 ? (
            <p className="text-sm text-gray-500 italic">No photos attached yet.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {photos.map((photo) => (
                <div key={photo.id} className="relative overflow-hidden rounded-md border bg-gray-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.url} alt="Manual mode reference" className="aspect-square w-full object-cover" />
                  <span
                    className={`absolute bottom-1 right-1 rounded px-1 py-0.5 text-[8px] font-bold uppercase text-white shadow-sm ${
                      photo.virusScanStatus === "clean"
                        ? "bg-emerald-600"
                        : photo.virusScanStatus === "infected" || photo.virusScanStatus === "failed"
                        ? "bg-red-600"
                        : "bg-amber-500"
                    }`}
                  >
                    {photo.virusScanStatus}
                  </span>
                </div>
              ))}
            </div>
          )}

          {!locked && (
            <div className="flex flex-wrap items-end gap-2 border-t pt-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Photo</label>
                <div className="flex h-10 items-center">
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => setSelectedPhoto(e.target.files?.[0] ?? null)}
                    className="text-sm text-gray-600 file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-input file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium file:text-gray-700 file:shadow-sm file:transition-colors hover:file:bg-gray-50"
                  />
                </div>
              </div>
              <Button type="button" onClick={handleUploadPhoto} disabled={uploadingPhoto}>
                {uploadingPhoto ? "Uploading..." : "Upload"}
              </Button>
            </div>
          )}
        </section>

        {/* Output package */}
        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Output Package</h2>
          <p className="text-sm text-gray-600">
            Generates the quote, grant application document, and BuilderTrend work order from the manually-entered
            data above. The submission must be marked ready first.
          </p>
          <Button
            onClick={handleGeneratePackage}
            disabled={submissionStatus !== "READY" || generating}
            className="w-full sm:w-auto"
          >
            {generating ? "Generating..." : "Generate Output Package"}
          </Button>
          {submissionStatus !== "READY" && !locked && (
            <p className="text-xs text-gray-500">Save and mark the submission ready to enable this action.</p>
          )}
        </section>
      </div>
    </main>
  );
}
