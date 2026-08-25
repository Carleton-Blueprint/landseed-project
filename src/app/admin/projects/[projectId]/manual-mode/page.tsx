import { prisma } from "lib/prisma";
import { auth } from "@/auth";
import { redirectToSignIn } from "lib/auth-redirect";
import { redirect, notFound } from "next/navigation";
import type { Metadata } from "next";
import { hasMinimumRole } from "@/backend/auth/requireRole";
import { signPhotosForDisplay } from "lib/photoUrls";
import { ManualModeClient, type ManualModeInitialData } from "./ManualModeClient";

export const metadata: Metadata = {
  title: "Manual Mode — Landseed Project Admin",
  description: "Complete a project end-to-end without AI analysis: manual scope, pricing, drawings, and output package generation.",
};

export default async function ManualModePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirectToSignIn(`/admin/projects/${projectId}/manual-mode`);
  const isAdmin = await hasMinimumRole(session, "ADMIN");
  if (!isAdmin) redirect("/dashboard");

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      address: true,
      status: true,
      isManualMode: true,
      user: { select: { name: true, email: true } },
      manualModeSubmission: true,
      quotes: { select: { id: true, source: true }, orderBy: { createdAt: "desc" } },
      documents: {
        where: { documentType: { in: ["MANUAL_MODE_DRAWING", "VENDOR_QUOTE"] } },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          fileName: true,
          documentType: true,
          label: true,
          virusScanStatus: true,
          createdAt: true,
        },
      },
      photos: {
        orderBy: { createdAt: "desc" },
        select: { id: true, url: true, virus_scan_status: true, createdAt: true },
      },
    },
  });

  if (!project) {
    notFound();
  }

  const signedPhotos = await signPhotosForDisplay(project.photos);

  const initialData: ManualModeInitialData = {
    projectId: project.id,
    address: project.address,
    clientName: project.user.name,
    clientEmail: project.user.email,
    status: project.status,
    hasExistingAiQuote: project.quotes.some((q) => q.source === "AI_GENERATED"),
    submission: project.manualModeSubmission
      ? {
          modificationType: project.manualModeSubmission.modificationType,
          scope: project.manualModeSubmission.scope,
          notes: project.manualModeSubmission.notes,
          pricingItems: project.manualModeSubmission.pricingItems as unknown as Array<{
            description: string;
            quantity: number;
            unitPrice: number;
          }>,
          subtotal: project.manualModeSubmission.subtotal.toNumber(),
          total: project.manualModeSubmission.total.toNumber(),
          status: project.manualModeSubmission.status,
        }
      : null,
    documents: project.documents.map((d) => ({
      id: d.id,
      fileName: d.fileName,
      documentType: d.documentType,
      label: d.label,
      virusScanStatus: d.virusScanStatus,
      createdAt: d.createdAt.toISOString(),
    })),
    photos: signedPhotos.map((p) => ({
      id: p.id,
      url: p.url,
      virusScanStatus: p.virus_scan_status,
      createdAt: p.createdAt.toISOString(),
    })),
  };

  return <ManualModeClient initialData={initialData} />;
}
