/**
 * Home page: renders the main landing content and the digital intake form.
 * Server component; IntakeForm is client-side for form state.
 */
import { IntakeForm } from "@/frontend/components/IntakeForm";
import { GuidedIntakeForm } from "@/frontend/components/GuidedIntakeForm";

export default function HomePage() {
  return (
    <main className="min-h-screen p-6 md:p-8" role="main">
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">
          Digital Intake
        </h1>
        <div className="mb-12">
          <GuidedIntakeForm />
        </div>
        <IntakeForm />
      </div>
    </main>
  );
}
