import { auth } from "@/auth";
import { prisma } from "lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/frontend/components/ui/button";

export default function DashboardPage() {
  return <DashboardContent />;
}

async function DashboardContent() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/api/auth/signin");
  }

  const projects = await prisma.project.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    include: { photos: true },
  });

  return (
    <main className="min-h-screen p-6 md:p-8 max-w-4xl mx-auto">
      <h1 className="mb-6 text-3xl font-bold tracking-tight text-gray-900 border-b pb-4">
        Your Dashboard
      </h1>
      
      <div className="space-y-6">
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <h2 className="text-xl font-semibold mb-4">Your Projects</h2>
          
          {projects.length === 0 ? (
            <p className="text-gray-500">You don&apos;t have any projects yet.</p>
          ) : (
            <div className="space-y-4">
              {projects.map((project) => (
                <div key={project.id} className="border rounded-md p-4 flex flex-col sm:flex-row justify-between sm:items-center gap-4 hover:bg-gray-50 transition-colors">
                  <div>
                    <h3 className="font-medium text-lg text-gray-900">{project.address}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${
                        project.status === "draft" ? "bg-amber-50 text-amber-700 border-amber-200" 
                        : "bg-blue-50 text-blue-700 border-blue-200"
                      }`}>
                        {project.status === "draft" ? "Pending" : project.status}
                      </span>
                      <span className="text-sm text-gray-500">
                        {new Date(project.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  
                  <div className="flex shrink-0">
                    {project.grantDocumentKey ? (
                      <Link href={`/api/documents/${project.id}/download`} target="_blank">
                        <Button variant="default" className="w-full sm:w-auto flex items-center gap-2">
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
                          Download Grant PDF
                        </Button>
                      </Link>
                    ) : (
                      <Button variant="outline" disabled className="w-full sm:w-auto">
                        Generating PDF...
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
