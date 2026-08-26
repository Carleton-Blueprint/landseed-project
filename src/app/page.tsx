/**
 * Home page: renders the main landing content and the digital intake form.
 * Server component; IntakePageContent is client-side for draft autosave.
 */
import { IntakePageContent } from "@/frontend/components/IntakePageContent";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-gray-50/60 p-6 md:p-8" role="main">
      <div className="mx-auto max-w-2xl py-4 md:py-8">
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight">
          Request Assessment
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          Tell us a bit about your home and needs.
        </p>
        <div className="mt-8">
          <IntakePageContent />
        </div>
      </div>
    </main>
  );
}
