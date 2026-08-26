import { auth } from "@/auth";
import { redirectToSignIn } from "lib/auth-redirect";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { hasMinimumRole } from "@/backend/auth/requireRole";
import { NewManualModeProjectClient } from "./NewManualModeProjectClient";

export const metadata: Metadata = {
  title: "New Manual Project — Landseed Project Admin",
  description: "Create a brand-new project from scratch for an existing client, entering Manual Mode immediately.",
};

export default async function NewManualModeProjectPage() {
  const session = await auth();
  if (!session?.user?.id) redirectToSignIn("/admin/manual-mode/new");
  const isAdmin = await hasMinimumRole(session, "ADMIN");
  if (!isAdmin) redirect("/dashboard");

  return <NewManualModeProjectClient />;
}
