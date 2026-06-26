import type { ReactNode } from "react";

type AuthPageShellProps = {
  title: string;
  description: string;
  children: ReactNode;
};

export function AuthPageShell({ title, description, children }: AuthPageShellProps) {
  return (
    <div className="relative min-h-screen bg-white flex items-center justify-center overflow-hidden font-sans z-0">
      <style>{`
        @keyframes drift-1 {
          from { background-position: 0 0; }
          to { background-position: 200px -200px; }
        }
        @keyframes drift-2 {
          from { background-position: 0 0; }
          to { background-position: -300px 300px; }
        }
        .bg-houses-1 {
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 24 24' fill='none' stroke='%2310b981' stroke-width='0.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'/%3E%3Cpolyline points='9 22 9 12 15 12 15 22'/%3E%3C/svg%3E");
          background-size: 200px 200px;
          animation: drift-1 50s linear infinite;
        }
        .bg-houses-2 {
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 24 24' fill='%2310b981' opacity='0.15' stroke='none'%3E%3Cpath d='m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'/%3E%3C/svg%3E");
          background-size: 300px 300px;
          animation: drift-2 70s linear infinite;
        }
      `}</style>

      <div className="fixed inset-0 -z-10 bg-houses-1 opacity-20 pointer-events-none" />
      <div className="fixed inset-0 -z-10 bg-houses-2 opacity-50 pointer-events-none" />

      <div className="relative z-10 w-full max-w-md mx-4 p-8 bg-white/90 backdrop-blur-md border border-gray-200/60 rounded-3xl shadow-xl">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-extrabold tracking-tight text-gray-900">{title}</h1>
          <p className="text-base text-gray-600 mt-2">{description}</p>
        </div>
        {children}
      </div>
    </div>
  );
}
