import { prisma } from "lib/prisma";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { AdminDashboardClient, SerializedProject } from "./AdminDashboardClient";

export const metadata: Metadata = {
  title: "Admin Dashboard — Landseed Project",
  description:
    "Client Advisory Team dashboard for monitoring project requests, AI estimations, and grant discovery results.",
};

/* ------------------------------------------------------------------ */
/* Page (Server Component)                                             */
/* ------------------------------------------------------------------ */

export default async function AdminDashboardPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/api/auth/signin?callbackUrl=/admin");
  }

  /* ---- Check if the user has EDITOR or OWNER role on at least one project ---- */
  const staffAccess = await prisma.projectAccess.findFirst({
    where: {
      userId: session.user.id,
      role: { in: ["EDITOR", "OWNER"] },
    },
    select: { id: true },
  });

  if (!staffAccess) {
    redirect("/dashboard");
  }

  /* ---- Fetch all projects ---- */
  const rawProjects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      user: {
        select: { id: true, name: true, email: true },
      },
      photos: {
        select: { id: true },
      },
    },
  });

  /* ---- Fetch related data separately to avoid Prisma client mismatch issues ---- */
  const projectIds = rawProjects.map((p) => p.id);

  type TransferRow = {
    id: string;
    projectId: string;
    status: string;
    attempts: number;
    lastError: string | null;
    sentAt: Date | null;
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
        id: true,
        projectId: true,
        subtotal: true,
        total: true,
        status: true,
        generatedAt: true,
        questions: {
          select: { id: true, status: true },
        },
      },
    }),
    prisma.eligibilityAssessment.findMany({
      where: {
        projectId: { in: projectIds },
        isLatest: true,
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const allFallbackExports = await prisma.manualFallbackExport.findMany({
    where: { projectId: { in: projectIds } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      projectId: true,
      status: true,
      requestedAt: true,
      readyAt: true,
      expiresAt: true,
      fileName: true,
      retentionDays: true,
      maxSizeBytes: true,
      lastError: true,
    },
  });

  // BuilderTrendTransfer may not exist in the generated Prisma client yet — access safely
  let allTransfers: TransferRow[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    allTransfers = await (prisma as any).builderTrendTransfer.findMany({
      where: { projectId: { in: projectIds } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        projectId: true,
        status: true,
        attempts: true,
        lastError: true,
        sentAt: true,
      },
    });
  } catch {
    // Table may not exist yet — silently fall back to empty
  }

  /* ---- Group by project ID ---- */
  const docsByProject = new Map<string, typeof allDocuments>();
  for (const d of allDocuments) {
    const arr = docsByProject.get(d.projectId) ?? [];
    arr.push(d);
    docsByProject.set(d.projectId, arr);
  }

  const quotesByProject = new Map<string, (typeof allQuotes)[0]>();
  for (const q of allQuotes) {
    if (!quotesByProject.has(q.projectId)) {
      quotesByProject.set(q.projectId, q); // latest first due to orderBy
    }
  }

  const assessmentsByProject = new Map<string, (typeof allAssessments)[0]>();
  for (const a of allAssessments) {
    if (!assessmentsByProject.has(a.projectId)) {
      assessmentsByProject.set(a.projectId, a);
    }
  }

  const transfersByProject = new Map<string, (typeof allTransfers)[0]>();
  for (const t of allTransfers) {
    if (!transfersByProject.has(t.projectId)) {
      transfersByProject.set(t.projectId, t);
    }
  }

  const fallbackExportsByProject = new Map<string, (typeof allFallbackExports)[0]>();
  for (const item of allFallbackExports) {
    if (!fallbackExportsByProject.has(item.projectId)) {
      fallbackExportsByProject.set(item.projectId, item);
    }
  }

  /* ---- Serialize for client component ---- */
  const serialized: SerializedProject[] = rawProjects.map((p) => {
    const docs = docsByProject.get(p.id) ?? [];
    const latestQuote = quotesByProject.get(p.id) ?? null;
    const latestAssessment = assessmentsByProject.get(p.id) ?? null;
    const latestTransfer = transfersByProject.get(p.id) ?? null;
    const latestFallbackExport = fallbackExportsByProject.get(p.id) ?? null;

    const aExtended = latestAssessment as typeof latestAssessment & {
      discoveredGrants?: unknown;
      discoveryProvider?: string | null;
    } | null;

    return {
      id: p.id,
      address: p.address,
      status: p.status,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      client: {
        id: p.user.id,
        name: p.user.name,
        email: p.user.email,
      },
      photoCount: p.photos.length,
      documentCount: docs.length,
      documentsPendingReview: docs.filter(
        (d: { reviewStatus: string }) => d.reviewStatus === "PENDING"
      ).length,
      quote: latestQuote
        ? {
            id: latestQuote.id,
            subtotal: latestQuote.subtotal.toString(),
            total: latestQuote.total.toString(),
            status: latestQuote.status,
            generatedAt: latestQuote.generatedAt.toISOString(),
            openQuestions: latestQuote.questions.filter(
              (q: { status: string }) => q.status === "OPEN"
            ).length,
          }
        : null,
      eligibility: aExtended
        ? {
            id: aExtended.id,
            overallDecision: aExtended.overallDecision,
            discoveredGrants: Array.isArray(aExtended.discoveredGrants)
              ? (aExtended.discoveredGrants as SerializedProject["eligibility"] extends null ? never : NonNullable<SerializedProject["eligibility"]>["discoveredGrants"])
              : [],
            provider: aExtended.discoveryProvider ?? "HEURISTIC",
            assessedAt: aExtended.createdAt.toISOString(),
          }
        : null,
      builderTrendTransfer: latestTransfer
        ? {
            id: latestTransfer.id,
            status: latestTransfer.status,
            attempts: latestTransfer.attempts,
            lastError: latestTransfer.lastError,
            sentAt: latestTransfer.sentAt?.toISOString() ?? null,
          }
        : null,
      manualFallbackExport: latestFallbackExport
        ? {
            id: latestFallbackExport.id,
            status: latestFallbackExport.status,
            requestedAt: latestFallbackExport.requestedAt.toISOString(),
            readyAt: latestFallbackExport.readyAt?.toISOString() ?? null,
            expiresAt: latestFallbackExport.expiresAt?.toISOString() ?? null,
            fileName: latestFallbackExport.fileName,
            retentionDays: latestFallbackExport.retentionDays,
            maxSizeBytes: latestFallbackExport.maxSizeBytes,
            lastError: latestFallbackExport.lastError,
          }
        : null,
    };
  });

  return <AdminDashboardClient projects={serialized} userName={session.user.name ?? "Team Member"} />;
}
