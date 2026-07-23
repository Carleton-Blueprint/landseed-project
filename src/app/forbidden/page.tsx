/**
 * Forbidden page — shown when the admin middleware redirects an
 * authenticated but insufficiently privileged browser request.
 */
import Link from "next/link";
import { Button } from "@/frontend/components/ui/button";

export default function ForbiddenPage() {
  return (
    <main className="flex min-h-[70vh] items-center justify-center px-6 py-12">
      <div className="mx-auto max-w-md text-center">
        <div
          className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 text-red-700"
          aria-hidden="true"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-8 w-8"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="m4.9 4.9 14.2 14.2" />
          </svg>
        </div>

        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          You don&apos;t have access
        </h1>
        <p className="mt-3 text-sm text-gray-700">
          Your account doesn&apos;t have permission to view this page. If you
          think this is a mistake, contact an administrator.
        </p>

        <div className="mt-8">
          <Link href="/dashboard">
            <Button size="lg">Back to dashboard</Button>
          </Link>
        </div>
      </div>
    </main>
  );
}
