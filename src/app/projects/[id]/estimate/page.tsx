import React from "react";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { prisma } from "lib/prisma";
import { auth } from "@/auth";
import { EstimateClientComponent } from "./EstimateClientComponent";
import { AskQuestionPanel } from "@/frontend/components/AskQuestionPanel";
import { ProjectTimeline } from "@/frontend/components/ProjectTimeline";
import { getAuditContextFromHeaders, logAuditEventNonBlocking } from "@/backend/audit/log";
import type { RefinedEstimate } from "@/backend/services/refinedEstimate";

function modificationItemsFromDraft(draftData: unknown): string[] {
  if (!draftData || typeof draftData !== "object" || Array.isArray(draftData)) return [];
  const raw = (draftData as Record<string, unknown>).modificationItems;
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string");
}

export default async function EstimatePage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const requestHeaders = await headers();
  const requestContext = getAuditContextFromHeaders(requestHeaders);

  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/api/auth/signin?callbackUrl=/projects/${params.id}/estimate`);
  }

  // Find the project and ensure user has access (either OWNER or admin-like)
  const project = await prisma.project.findUnique({
    where: { id: params.id },
    include: {
      quotes: {
        orderBy: { generatedAt: 'desc' },
        take: 1,
      },
      projectAccess: {
        where: { userId: session.user.id },
      },
    },
  });

  if (!project) return notFound();

  // Basic access check: Must have access record
  if (project.projectAccess.length === 0) {
    await logAuditEventNonBlocking({
      category: "SENSITIVE_ACCESS",
      action: "ESTIMATE_VIEW",
      outcome: "DENIED",
      sensitivityLevel: "RESTRICTED",
      actorUserId: session.user.id,
      projectId: project.id,
      resourceType: "estimate",
      resourceId: project.id,
      description: "Estimate page access denied due to missing project access",
      ...requestContext,
    });

    return (
        <div className="flex h-screen items-center justify-center p-4 text-center">
            <p className="text-xl text-red-600">You do not have access to this estimate.</p>
        </div>
    );
  }

  const latestQuote = project.quotes[0];
  const refinedEstimate = (latestQuote?.refinedEstimate ?? null) as RefinedEstimate | null;

  if (!latestQuote) {
    await logAuditEventNonBlocking({
      category: "SENSITIVE_ACCESS",
      action: "ESTIMATE_VIEW",
      outcome: "SUCCESS",
      sensitivityLevel: "RESTRICTED",
      actorUserId: session.user.id,
      projectId: project.id,
      resourceType: "estimate",
      resourceId: project.id,
      description: "Estimate page viewed while quote is still pending generation",
      ...requestContext,
    });

    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-blue-100 flex items-center justify-center">
            <svg className="w-8 h-8 text-blue-500 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Preparing Your Estimate</h2>
          <p className="text-gray-500">Your refined estimate is still being prepared. Please check back later.</p>
        </div>
      </div>
    );
  }

  await logAuditEventNonBlocking({
    category: "SENSITIVE_ACCESS",
    action: "ESTIMATE_VIEW",
    outcome: "SUCCESS",
    sensitivityLevel: "RESTRICTED",
    actorUserId: session.user.id,
    projectId: project.id,
    quoteId: latestQuote.id,
    resourceType: "estimate",
    resourceId: latestQuote.id,
    description: "Estimate page viewed",
    metadata: {
      quoteStatus: latestQuote.status,
    },
    ...requestContext,
  });

  const formattedSubtotal = Number(latestQuote.subtotal).toLocaleString("en-US", { style: "currency", currency: "CAD" });
  const formattedTotal = Number(latestQuote.total).toLocaleString("en-US", { style: "currency", currency: "CAD" });

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <div className="border-b bg-white">
        <div className="max-w-3xl mx-auto px-6 py-3 flex items-center gap-3">
          <a href={`/dashboard/${project.id}`} className="text-gray-500 hover:text-gray-800 text-sm font-medium flex items-center gap-1">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            Back to Project
          </a>
          <span className="text-gray-300">/</span>
          <span className="text-sm font-semibold text-gray-800">Refined Estimate</span>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {/* Page Header */}
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Refined Estimate</h1>
          <p className="mt-1 text-gray-500 text-sm">Review your detailed cost breakdown and make your decision</p>
        </div>

        {/* Project & Cost Card */}
        <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
          <div className="p-6 border-b border-gray-100">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-3">
              <svg className="h-5 w-5 text-indigo-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
              </svg>
              Project Details
            </h2>
            <p className="text-gray-700"><strong>Address:</strong> {project.address}</p>
          </div>

          <div className="p-6 bg-gradient-to-br from-gray-50 to-white">
            <h3 className="text-base font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <svg className="h-5 w-5 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Cost Summary
            </h3>
            <div className="flex justify-between py-3 border-b border-gray-200">
              <span className="text-gray-500">Subtotal</span>
              <span className="font-medium text-gray-800">{formattedSubtotal}</span>
            </div>
            {refinedEstimate ? (
              <>
                <div className="flex justify-between py-2 border-b border-gray-200">
                  <span className="text-gray-600">Labor</span>
                  <span className="font-medium">${refinedEstimate.laborTotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-gray-200">
                  <span className="text-gray-600">Markup</span>
                  <span className="font-medium">${refinedEstimate.markupTotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-gray-200">
                  <span className="text-gray-600">Estimate Range</span>
                  <span className="font-medium">${refinedEstimate.estimateMin.toFixed(2)} - ${refinedEstimate.estimateMax.toFixed(2)}</span>
                </div>
              </>
            ) : null}
            <div className="flex justify-between py-4 mt-1">
              <span className="text-lg font-bold text-indigo-700">Total Estimate</span>
              <span className="text-lg font-bold text-indigo-700">{formattedTotal}</span>
            </div>
          </div>
        </div>
        {refinedEstimate ? (
          <div className="bg-white shadow rounded-lg p-6 mb-8">
            <h3 className="text-xl font-semibold mb-4">Itemized Refined Estimate</h3>
            <div className="space-y-4">
              {refinedEstimate.lineItems.map((item, index) => (
                <div key={index} className="rounded-lg border border-gray-200 p-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-semibold text-gray-900">{item.description}</p>
                      <p className="text-sm text-gray-600">Qty: {item.quantity}</p>
                    </div>
                    <p className="text-right text-sm text-gray-600">Total: ${item.lineTotal.toFixed(2)}</p>
                  </div>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    <div className="rounded bg-gray-50 p-3">
                      <p className="text-xs uppercase tracking-wide text-gray-500">Material</p>
                      <p className="text-sm text-gray-900">${item.materialTotal.toFixed(2)}</p>
                      <p className="text-xs text-gray-500">Unit ${item.materialUnitCost.toFixed(2)}</p>
                    </div>
                    <div className="rounded bg-gray-50 p-3">
                      <p className="text-xs uppercase tracking-wide text-gray-500">Labor</p>
                      <p className="text-sm text-gray-900">${item.laborTotal.toFixed(2)}</p>
                      <p className="text-xs text-gray-500">{item.laborHours} hrs @ ${item.laborRate.toFixed(2)}</p>
                    </div>
                    <div className="rounded bg-gray-50 p-3">
                      <p className="text-xs uppercase tracking-wide text-gray-500">Markup</p>
                      <p className="text-sm text-gray-900">${item.markupTotal.toFixed(2)}</p>
                      <p className="text-xs text-gray-500">{Math.round(item.markupPercentage * 100)}%</p>
                    </div>
                    <div className="rounded bg-gray-50 p-3">
                      <p className="text-xs uppercase tracking-wide text-gray-500">Price Source</p>
                      <p className="text-sm text-gray-900">{item.pricingSource || "Mocked pricing"}</p>
                      {item.pricingLink ? (
                        <p className="text-xs text-blue-600"><a href={item.pricingLink} target="_blank" rel="noreferrer">View source</a></p>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* Project Timeline */}
        <ProjectTimeline modificationItems={modificationItemsFromDraft(project.draftData)} />

        {/* Accept/Decline Component */}
        <EstimateClientComponent
          quoteId={latestQuote.id}
          initialStatus={latestQuote.status}
          initialReason={latestQuote.declinedReason}
        />

        {/* Ask a Question Section */}
        <div className="mt-8">
          <AskQuestionPanel quoteId={latestQuote.id} />
        </div>
      </div>
    </div>
  );
}
