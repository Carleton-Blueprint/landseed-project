export default function DashboardLoading() {
  return (
    <main className="min-h-screen bg-gray-50">
      <div className="border-b bg-white">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between md:px-8">
          <div className="min-w-0 space-y-2">
            <div className="h-8 w-48 animate-pulse rounded bg-gray-200" />
            <div className="h-4 w-72 animate-pulse rounded bg-gray-100" />
          </div>
          <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-gray-200" />
        </div>
      </div>

      <div className="mx-auto max-w-5xl space-y-4 px-6 py-6 md:px-8">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="space-y-3 rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
          >
            <div className="flex items-center justify-between gap-4">
              <div className="h-5 w-56 animate-pulse rounded bg-gray-200" />
              <div className="h-5 w-20 animate-pulse rounded-full bg-gray-100" />
            </div>
            <div className="h-4 w-full max-w-md animate-pulse rounded bg-gray-100" />
            <div className="h-4 w-2/3 max-w-sm animate-pulse rounded bg-gray-100" />
          </div>
        ))}
      </div>
    </main>
  );
}
