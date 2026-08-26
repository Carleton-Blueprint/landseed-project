"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/frontend/components/ui/button";
import { Input } from "@/frontend/components/ui/input";

interface ClientSearchResult {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
}

const PROVINCES = ["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"] as const;

export function NewManualModeProjectClient() {
  const router = useRouter();

  const [clientQuery, setClientQuery] = useState("");
  const [clientResults, setClientResults] = useState<ClientSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedClient, setSelectedClient] = useState<ClientSearchResult | null>(null);

  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [province, setProvince] = useState("ON");
  const [postalCode, setPostalCode] = useState("");
  const [ownershipStatus, setOwnershipStatus] = useState<"owner" | "tenant" | "other">("owner");
  const [ownershipOtherDetails, setOwnershipOtherDetails] = useState("");
  const [landlordName, setLandlordName] = useState("");
  const [landlordPhone, setLandlordPhone] = useState("");
  const [urgency, setUrgency] = useState<"immediate" | "soon" | "planning" | "just exploring">("planning");

  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (selectedClient) return;
    const query = clientQuery.trim();
    if (!query) {
      setClientResults([]);
      return;
    }

    setSearching(true);
    const timeout = setTimeout(async () => {
      try {
        const response = await fetch(`/api/admin/manual-mode/clients?q=${encodeURIComponent(query)}`);
        const body = await response.json();
        setClientResults(response.ok ? body.clients : []);
      } catch {
        setClientResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(timeout);
  }, [clientQuery, selectedClient]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setErrorMessage(null);

    if (!selectedClient) {
      setErrorMessage("Search for and select the client this project is for.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/admin/manual-mode/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientUserId: selectedClient.id,
          address: {
            addressLine1,
            addressLine2,
            city,
            province,
            postalCode,
            ownershipStatus,
            ownershipOtherDetails,
            landlordName,
            landlordPhone,
            urgency,
          },
        }),
      });

      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to create project");
      }

      router.push(`/admin/projects/${body.projectId}/manual-mode`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to create project");
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <Link href="/admin" className="text-sm text-blue-600 hover:underline">
            &larr; Back to Admin Dashboard
          </Link>
          <h1 className="mt-2 text-3xl font-bold text-gray-900">New Manual Project</h1>
          <p className="mt-1 text-gray-600">
            Create a project from scratch for an existing client, entering Manual Mode immediately — no client
            intake required.
          </p>
        </div>

        {errorMessage && (
          <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">{errorMessage}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Client picker */}
          <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">Client</h2>

            {selectedClient ? (
              <div className="flex items-center justify-between rounded-md border bg-gray-50 px-3 py-2 text-sm">
                <div>
                  <p className="font-medium text-gray-800">{selectedClient.name ?? "Unnamed client"}</p>
                  <p className="text-xs text-gray-500">{selectedClient.email ?? "no email"}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSelectedClient(null);
                    setClientQuery("");
                  }}
                >
                  Change
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <Input
                  aria-label="Search registered clients by name or email"
                  value={clientQuery}
                  onChange={(e) => setClientQuery(e.target.value)}
                  placeholder="Search registered clients by name or email"
                />
                {searching && <p className="text-xs text-gray-500">Searching...</p>}
                {clientResults.length > 0 && (
                  <ul className="divide-y rounded-md border">
                    {clientResults.map((client) => (
                      <li key={client.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedClient(client);
                            setClientResults([]);
                          }}
                          className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-gray-50"
                        >
                          <span className="font-medium text-gray-800">{client.name ?? "Unnamed client"}</span>
                          <span className="text-xs text-gray-500">{client.email ?? "no email"}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {!searching && clientQuery.trim() && clientResults.length === 0 && (
                  <p className="text-xs text-gray-500">No registered clients match &quot;{clientQuery}&quot;.</p>
                )}
              </div>
            )}
          </section>

          {/* Address / intake details */}
          <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">Project Address &amp; Details</h2>

            <div>
              <label htmlFor="nmp-addressLine1" className="block text-sm font-medium text-gray-700 mb-1">
                Street Address
              </label>
              <Input id="nmp-addressLine1" value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} required />
            </div>
            <div>
              <label htmlFor="nmp-addressLine2" className="block text-sm font-medium text-gray-700 mb-1">
                Address Line 2 (optional)
              </label>
              <Input id="nmp-addressLine2" value={addressLine2} onChange={(e) => setAddressLine2(e.target.value)} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-1">
                <label htmlFor="nmp-city" className="block text-sm font-medium text-gray-700 mb-1">
                  City
                </label>
                <Input id="nmp-city" value={city} onChange={(e) => setCity(e.target.value)} required />
              </div>
              <div>
                <label htmlFor="nmp-province" className="block text-sm font-medium text-gray-700 mb-1">
                  Province
                </label>
                <select
                  id="nmp-province"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={province}
                  onChange={(e) => setProvince(e.target.value)}
                >
                  {PROVINCES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="nmp-postalCode" className="block text-sm font-medium text-gray-700 mb-1">
                  Postal Code
                </label>
                <Input id="nmp-postalCode" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} required />
              </div>
            </div>

            <div>
              <label htmlFor="nmp-ownershipStatus" className="block text-sm font-medium text-gray-700 mb-1">
                Ownership Status
              </label>
              <select
                id="nmp-ownershipStatus"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={ownershipStatus}
                onChange={(e) => setOwnershipStatus(e.target.value as "owner" | "tenant" | "other")}
              >
                <option value="owner">Owner</option>
                <option value="tenant">Tenant</option>
                <option value="other">Other</option>
              </select>
            </div>

            {ownershipStatus === "tenant" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="nmp-landlordName" className="block text-sm font-medium text-gray-700 mb-1">
                    Landlord Name
                  </label>
                  <Input id="nmp-landlordName" value={landlordName} onChange={(e) => setLandlordName(e.target.value)} required />
                </div>
                <div>
                  <label htmlFor="nmp-landlordPhone" className="block text-sm font-medium text-gray-700 mb-1">
                    Landlord Phone
                  </label>
                  <Input id="nmp-landlordPhone" value={landlordPhone} onChange={(e) => setLandlordPhone(e.target.value)} required />
                </div>
              </div>
            )}

            {ownershipStatus === "other" && (
              <div>
                <label htmlFor="nmp-ownershipOtherDetails" className="block text-sm font-medium text-gray-700 mb-1">
                  Ownership Details
                </label>
                <Input
                  id="nmp-ownershipOtherDetails"
                  value={ownershipOtherDetails}
                  onChange={(e) => setOwnershipOtherDetails(e.target.value)}
                  required
                />
              </div>
            )}

            <div>
              <label htmlFor="nmp-urgency" className="block text-sm font-medium text-gray-700 mb-1">
                Urgency
              </label>
              <select
                id="nmp-urgency"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={urgency}
                onChange={(e) =>
                  setUrgency(e.target.value as "immediate" | "soon" | "planning" | "just exploring")
                }
              >
                <option value="immediate">Immediate</option>
                <option value="soon">Soon</option>
                <option value="planning">Planning</option>
                <option value="just exploring">Just exploring</option>
              </select>
            </div>
          </section>

          <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
            {submitting ? "Creating..." : "Create Project & Continue"}
          </Button>
        </form>
      </div>
    </main>
  );
}
