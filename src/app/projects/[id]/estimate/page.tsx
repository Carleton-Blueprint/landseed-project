import React from "react";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { prisma } from "lib/prisma";
import { auth } from "@/auth";
import { EstimateClientComponent } from "./EstimateClientComponent";
import { AskQuestionPanel } from "@/frontend/components/AskQuestionPanel";
import { getAuditContextFromHeaders, logAuditEventNonBlocking } from "@/backend/audit/log";

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
            <div className="flex justify-between py-2 font-bold text-lg mt-2 text-blue-700">
              <span>Total Estimate</span>
              <span>${latestQuote.total.toString()}</span>
            </div>
          </div>
        </div>

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

