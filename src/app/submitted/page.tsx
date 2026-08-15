import { redirect } from "next/navigation";

type SubmittedPageProps = {
  searchParams: Promise<{ projectId?: string }>;
};

export default async function SubmittedPage({ searchParams }: SubmittedPageProps) {
  const { projectId } = await searchParams;

  if (projectId) {
    redirect(`/dashboard?tab=submitted&submitted=true&projectId=${encodeURIComponent(projectId)}`);
  } else {
    redirect("/dashboard?tab=submitted&submitted=true");
  }
}
