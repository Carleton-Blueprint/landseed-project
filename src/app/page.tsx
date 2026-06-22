/**
 * Home page: renders the main landing content and the digital intake form.
 * Server component; IntakePageContent is client-side for draft autosave.
 */
import { IntakePageContent } from "@/frontend/components/IntakePageContent";

export default function HomePage() {
  return (
    <main className="min-h-screen p-6 md:p-8" role="main">
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">
          Request Assessment
        </h1>
        <IntakePageContent />
      </div>
    </main>
  );
}
