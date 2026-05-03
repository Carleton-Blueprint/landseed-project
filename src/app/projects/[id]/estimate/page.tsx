import React from "react";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { prisma } from "lib/prisma";
import { auth } from "@/auth";
import { EstimateClientComponent } from "./EstimateClientComponent";
import { AskQuestionPanel } from "@/frontend/components/AskQuestionPanel";
import { getAuditContextFromHeaders, logAuditEventNonBlocking } from "@/backend/audit/log";
import type { RefinedEstimate } from "@/backend/services/refinedEstimate";

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
  const refinedEstimate = (latestQuote as any)?.refinedEstimate as RefinedEstimate | null;

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
        <div className="flex h-screen items-center justify-center p-4 text-center">
            <p className="text-xl">Your estimate is still being prepared. Please check back later.</p>
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

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Refined Estimate</h1>
        
        <div className="bg-white shadow rounded-lg p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4">Project Details</h2>
          <p className="text-gray-700 mb-2"><strong>Address:</strong> {project.address}</p>
          <p className="text-gray-700 mb-6"><strong>Quote ID:</strong> {latestQuote.id}</p>

          <div className="border-t border-gray-200 mt-6 pt-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Cost Summary</h3>
            <div className="flex justify-between py-2 border-b">
              <span className="text-gray-600">Subtotal</span>
              <span className="font-medium">${latestQuote.subtotal.toString()}</span>
            </div>
            {refinedEstimate ? (
              <>
                <div className="flex justify-between py-2 border-b">
                  <span className="text-gray-600">Labor</span>
                  <span className="font-medium">${refinedEstimate.laborTotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between py-2 border-b">
                  <span className="text-gray-600">Markup</span>
                  <span className="font-medium">${refinedEstimate.markupTotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between py-2 border-b">
                  <span className="text-gray-600">Estimate Range</span>
                  <span className="font-medium">${refinedEstimate.estimateMin.toFixed(2)} - ${refinedEstimate.estimateMax.toFixed(2)}</span>
                </div>
              </>
            ) : null}
            <div className="flex justify-between py-2 font-bold text-lg mt-2 text-blue-700">
              <span>Total Estimate</span>
              <span>${latestQuote.total.toString()}</span>
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

