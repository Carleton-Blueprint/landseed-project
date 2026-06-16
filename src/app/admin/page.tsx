import { prisma } from "lib/prisma";
import { auth } from "@/auth";
import { redirectToSignIn } from "lib/auth-redirect";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { AdminDashboardClient, SerializedProject } from "./AdminDashboardClient";
import { hasMinimumRole } from "@/backend/auth/requireRole";

export const metadata: Metadata = {
  title: "Advisor Panel — Landseed Project",
  description:
    "Client Advisory Team portal for monitoring project requests, AI estimations, and grant discovery results.",
};

/* ------------------------------------------------------------------ */
/* Page (Server Component)                                             */
/* ------------------------------------------------------------------ */

export default async function AdminDashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirectToSignIn("/admin");
  const isAdmin = await hasMinimumRole(session, "ADMIN");
  if (!isAdmin) redirect("/dashboard");
  const userName = session.user.name ?? "Team Member";

  /* ---- Fetch all data (dev-safe: renders empty if no DB) ---- */
  let serialized: SerializedProject[] = [];
  try {
    const rawProjects = await prisma.project.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { id: true, name: true, email: true } },
        photos: { select: { id: true } },
        manualReviewFlag: true,
      },
    });

    const projectIds = rawProjects.map((p) => p.id);

    type TransferRow = {
      id: string; projectId: string; status: string;
      attempts: number; lastError: string | null; sentAt: Date | null;
    };

    const [allDocuments, allQuotes, allAssessments] = await Promise.all([
      prisma.document.findMany({
        where: { projectId: { in: projectIds } },
        select: { projectId: true, id: true, documentType: true, reviewStatus: true },
      }),
      prisma.quote.findMany({
        where: { projectId: { in: projectIds } },
        orderBy: { createdAt: "desc" },
        select: {
          id: true, projectId: true, subtotal: true, total: true,
          status: true, generatedAt: true,
          estimateMin: true, estimateMax: true,
          questions: { select: { id: true, status: true } },
        },
      }),
      prisma.eligibilityAssessment.findMany({
        where: { projectId: { in: projectIds }, isLatest: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const allFallbackExports = await prisma.manualFallbackExport.findMany({
      where: { projectId: { in: projectIds } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, projectId: true, status: true, requestedAt: true,
        readyAt: true, expiresAt: true, fileName: true,
        retentionDays: true, maxSizeBytes: true, lastError: true,
      },
    });

    let allTransfers: TransferRow[] = [];
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      allTransfers = await (prisma as any).builderTrendTransfer.findMany({
        where: { projectId: { in: projectIds } },
        orderBy: { createdAt: "desc" },
        select: { id: true, projectId: true, status: true, attempts: true, lastError: true, sentAt: true },
      });
    } catch { /* table may not exist yet */ }

    const docsByProject = new Map<string, typeof allDocuments>();
    for (const d of allDocuments) {
      const arr = docsByProject.get(d.projectId) ?? [];
      arr.push(d);
      docsByProject.set(d.projectId, arr);
    }
    const quotesByProject = new Map<string, (typeof allQuotes)[0]>();
    for (const q of allQuotes) { if (!quotesByProject.has(q.projectId)) quotesByProject.set(q.projectId, q); }
    const assessmentsByProject = new Map<string, (typeof allAssessments)[0]>();
    for (const a of allAssessments) { if (!assessmentsByProject.has(a.projectId)) assessmentsByProject.set(a.projectId, a); }
    const transfersByProject = new Map<string, (typeof allTransfers)[0]>();
    for (const t of allTransfers) { if (!transfersByProject.has(t.projectId)) transfersByProject.set(t.projectId, t); }
    const fallbackExportsByProject = new Map<string, (typeof allFallbackExports)[0]>();
    for (const item of allFallbackExports) { if (!fallbackExportsByProject.has(item.projectId)) fallbackExportsByProject.set(item.projectId, item); }

    serialized = rawProjects.map((p) => {
      const docs = docsByProject.get(p.id) ?? [];
      const latestQuote = quotesByProject.get(p.id) ?? null;
      const latestAssessment = assessmentsByProject.get(p.id) ?? null;
      const latestTransfer = transfersByProject.get(p.id) ?? null;
      const latestFallbackExport = fallbackExportsByProject.get(p.id) ?? null;
      const aExtended = latestAssessment as typeof latestAssessment & {
        discoveredGrants?: unknown; discoveryProvider?: string | null;
      } | null;

      // Infer modification type from address/details
      const addressLower = p.address.toLowerCase();
      let inferredModType = "GRAB_BARS";
      if (addressLower.includes("ramp")) inferredModType = "RAMPS";
      else if (addressLower.includes("stair") || addressLower.includes("lift")) inferredModType = "STAIR_LIFT";
      else if (addressLower.includes("shower") || addressLower.includes("bath")) inferredModType = "SHOWER";
      else if (addressLower.includes("door") || addressLower.includes("hall")) inferredModType = "DOORS";

      return {
        id: p.id, address: p.address, status: p.status,
        createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString(),
        modificationType: inferredModType,
        hasManualReviewFlag: p.manualReviewFlag !== null && p.manualReviewFlag.isActive,
        manualReviewReason: p.manualReviewFlag?.reason ?? null,
        client: { id: p.user.id, name: p.user.name, email: p.user.email },
        photoCount: p.photos.length,
        documentCount: docs.length,
        documentsPendingReview: docs.filter((d: { reviewStatus: string }) => d.reviewStatus === "PENDING").length,
        quote: latestQuote ? {
          id: latestQuote.id,
          subtotal: latestQuote.subtotal.toString(),
          total: latestQuote.total.toString(),
          status: latestQuote.status,
          generatedAt: latestQuote.generatedAt.toISOString(),
          openQuestions: latestQuote.questions.filter((q: { status: string }) => q.status === "OPEN").length,
          estimateMin: latestQuote.estimateMin ? latestQuote.estimateMin.toString() : null,
          estimateMax: latestQuote.estimateMax ? latestQuote.estimateMax.toString() : null,
        } : null,
        eligibility: aExtended ? {
          id: aExtended.id,
          overallDecision: aExtended.overallDecision,
          discoveredGrants: Array.isArray(aExtended.discoveredGrants)
            ? (aExtended.discoveredGrants as SerializedProject["eligibility"] extends null ? never : NonNullable<SerializedProject["eligibility"]>["discoveredGrants"])
            : [],
          provider: aExtended.discoveryProvider ?? "HEURISTIC",
          assessedAt: aExtended.createdAt.toISOString(),
        } : null,
        builderTrendTransfer: latestTransfer ? {
          id: latestTransfer.id, status: latestTransfer.status,
          attempts: latestTransfer.attempts, lastError: latestTransfer.lastError,
          sentAt: latestTransfer.sentAt?.toISOString() ?? null,
        } : null,
        manualFallbackExport: latestFallbackExport ? {
          id: latestFallbackExport.id, status: latestFallbackExport.status,
          requestedAt: latestFallbackExport.requestedAt.toISOString(),
          readyAt: latestFallbackExport.readyAt?.toISOString() ?? null,
          expiresAt: latestFallbackExport.expiresAt?.toISOString() ?? null,
          fileName: latestFallbackExport.fileName,
          retentionDays: latestFallbackExport.retentionDays,
          maxSizeBytes: latestFallbackExport.maxSizeBytes,
          lastError: latestFallbackExport.lastError,
        } : null,
      };
    });
  } catch {
    // No DB connection in dev — fallback to dev mock injector
  }

  if (serialized.length === 0 && process.env.NODE_ENV === "development") {
    serialized = [
      {
        id: "proj-101",
        address: "105 Silver Birch Lane (Grab Bars & Safety Rails)",
        status: "submitted",
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
        updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 1).toISOString(),
        modificationType: "GRAB_BARS",
        hasManualReviewFlag: false,
        manualReviewReason: null,
        client: { id: "client-1", name: "Margaret Higgins", email: "margaret.h@example.com" },
        photoCount: 4,
        documentCount: 2,
        documentsPendingReview: 1,
        quote: {
          id: "quote-101",
          subtotal: "1450.00",
          total: "1450.00",
          status: "PENDING",
          generatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
          openQuestions: 0,
          estimateMin: "1200.00",
          estimateMax: "1800.00",
        },
        eligibility: {
          id: "elig-101",
          overallDecision: "ELIGIBLE",
          discoveredGrants: [
            {
              grantId: "grant-1",
              title: "Senior Home Independence Grant",
              scope: "MUNICIPAL",
              decision: "ELIGIBLE",
              relevanceScore: 92,
              confidence: "HIGH",
              summary: "Covers 100% of grab bar and bathroom modifications up to $2,500.",
            },
            {
              grantId: "grant-2",
              title: "Provincial Accessibility Improvement Support",
              scope: "PROVINCIAL",
              decision: "ELIGIBLE",
              relevanceScore: 85,
              confidence: "HIGH",
              summary: "Supports bathroom safety adaptations.",
            }
          ],
          provider: "OPENAI",
          assessedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
        },
        builderTrendTransfer: null,
      },
      {
        id: "proj-102",
        address: "442 Maplewood Avenue (Wheelchair Ramp Installation)",
        status: "estimate_ready",
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 10).toISOString(),
        updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 8).toISOString(),
        modificationType: "RAMPS",
        hasManualReviewFlag: false,
        manualReviewReason: null,
        client: { id: "client-2", name: "Arthur Pendelton", email: "arthur.p@example.com" },
        photoCount: 6,
        documentCount: 3,
        documentsPendingReview: 0,
        quote: {
          id: "quote-102",
          subtotal: "4200.00",
          total: "4200.00",
          status: "ACCEPTED",
          generatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 8).toISOString(),
          openQuestions: 0,
          estimateMin: "4000.00",
          estimateMax: "4500.00",
        },
        eligibility: {
          id: "elig-102",
          overallDecision: "ELIGIBLE",
          discoveredGrants: [
            {
              grantId: "grant-3",
              title: "Provincial Ramps & Lifts Program",
              scope: "PROVINCIAL",
              decision: "ELIGIBLE",
              relevanceScore: 95,
              confidence: "HIGH",
              summary: "Covers ramp installs up to $5,000 for verified residents.",
            }
          ],
          provider: "OPENAI",
          assessedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 10).toISOString(),
        },
        builderTrendTransfer: {
          id: "transfer-102",
          status: "PENDING",
          attempts: 1,
          lastError: null,
          sentAt: null,
        },
      },
      {
        id: "proj-103",
        address: "702 Oak Ridge Terrace (Multi-Floor Stair Lift)",
        status: "draft",
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 1).toISOString(),
        updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 1).toISOString(),
        modificationType: "STAIR_LIFT",
        hasManualReviewFlag: true,
        manualReviewReason: "HIGH_COMPLEXITY",
        client: { id: "client-3", name: "Elizabeth Vance", email: "elizabeth.v@example.com" },
        photoCount: 2,
        documentCount: 1,
        documentsPendingReview: 1,
        quote: null,
        eligibility: {
          id: "elig-103",
          overallDecision: "MANUAL_REVIEW",
          discoveredGrants: [
            {
              grantId: "grant-4",
              title: "Provincial Lift Assist Grant",
              scope: "PROVINCIAL",
              decision: "MANUAL_REVIEW",
              relevanceScore: 72,
              confidence: "MEDIUM",
              summary: "Covers stair lift modifications but requires physical therapist signature.",
            }
          ],
          provider: "HEURISTIC",
          assessedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 1).toISOString(),
        },
        builderTrendTransfer: null,
      },
      {
        id: "proj-104",
        address: "18 Pine Meadows Road (Walk-in Shower Conversion)",
        status: "estimate_expired",
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 40).toISOString(),
        updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString(),
        modificationType: "SHOWER",
        hasManualReviewFlag: true,
        manualReviewReason: "LOW_CONFIDENCE",
        client: { id: "client-4", name: "Robert Chen", email: "robert.c@example.com" },
        photoCount: 8,
        documentCount: 4,
        documentsPendingReview: 0,
        quote: {
          id: "quote-104",
          subtotal: "7500.00",
          total: "7500.00",
          status: "EXPIRED",
          generatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString(),
          openQuestions: 1,
          estimateMin: "6000.00",
          estimateMax: "7000.00",
        },
        eligibility: {
          id: "elig-104",
          overallDecision: "NEEDS_MORE_INFO",
          discoveredGrants: [
            {
              grantId: "grant-5",
              title: "Municipal Bathroom Accessibility Fund",
              scope: "MUNICIPAL",
              decision: "NEEDS_MORE_INFO",
              relevanceScore: 65,
              confidence: "LOW",
              summary: "Bathroom upgrades fund. Missing OT signature.",
            }
          ],
          provider: "HEURISTIC",
          assessedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString(),
        },
        builderTrendTransfer: null,
      },
      {
        id: "proj-105",
        address: "59 Winding Creek Way (Door Widening & Hallways)",
        status: "accepted",
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 14).toISOString(),
        updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 12).toISOString(),
        modificationType: "DOORS",
        hasManualReviewFlag: false,
        manualReviewReason: null,
        client: { id: "client-5", name: "Sarah Jenkins", email: "sarah.j@example.com" },
        photoCount: 3,
        documentCount: 2,
        documentsPendingReview: 0,
        quote: {
          id: "quote-105",
          subtotal: "2850.00",
          total: "2850.00",
          status: "ACCEPTED",
          generatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 12).toISOString(),
          openQuestions: 0,
          estimateMin: "2500.00",
          estimateMax: "3200.00",
        },
        eligibility: {
          id: "elig-105",
          overallDecision: "ELIGIBLE",
          discoveredGrants: [
            {
              grantId: "grant-6",
              title: "Senior Home Adaptation Grant",
              scope: "PROVINCIAL",
              decision: "ELIGIBLE",
              relevanceScore: 88,
              confidence: "MEDIUM",
              summary: "Supports door widening and entryway alterations up to $3,500.",
            }
          ],
          provider: "OPENAI",
          assessedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 14).toISOString(),
        },
        builderTrendTransfer: {
          id: "transfer-105",
          status: "SENT",
          attempts: 1,
          lastError: null,
          sentAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 12).toISOString(),
        },
      }
    ];
  }

  return <AdminDashboardClient projects={serialized} userName={userName} />;
}
