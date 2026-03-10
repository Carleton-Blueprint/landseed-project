# Landseed Project

Next.js (App Router) app with TypeScript, Tailwind CSS, and a clear split between frontend, backend, and shared libs. Set up for digital intake, photo uploads, and background jobs (virus scanning, AI) with WCAG 2.1 Level AA in mind.

## Structure

- **`/src/frontend`** – UI components (shadcn/ui), hooks (React Query), global styles
- **`/src/backend`** – Business logic, services (image, PDF, queue)
- **`/src/app`** – Routes and API endpoints
- **`/prisma`** – Schema and migrations
- **`/lib`** – Shared instances (Prisma, S3 placeholder)

## Setup

1. **Install dependencies** (from project root):

   ```bash
   npm install
   ```

2. **Environment**

   Copy `.env.example` to `.env` and set:

   - `DATABASE_URL` – PostgreSQL connection string
   - `NEXTAUTH_SECRET` – e.g. `openssl rand -base64 32`
   - `NEXTAUTH_URL` – e.g. `http://localhost:3000`
   - `OPENAI_API_KEY`, `AWS_S3_BUCKET`, `REDIS_URL` as needed

3. **Database**

   ```bash
   npm run db:generate
   npm run db:push
   ```

4. **Run**

   ```bash
   npm run dev
   ```

## Quickstart: How everything works together

### Request flow (high level)

1. **Browser → Next.js**  
   Every request hits the App Router. `src/app/layout.tsx` wraps the app with fonts and **Providers** (React Query + NextAuth session). Page components in `src/app` are server-rendered by default; client components in `src/frontend` run in the browser.

2. **Home page**  
   `src/app/page.tsx` renders the **IntakeForm** from `src/frontend/components/IntakeForm.tsx`. The form uses React Hook Form + Zod for validation and the shared **Button** and **Input** from `src/frontend/components/ui` (shadcn-style). Styling comes from `src/app/globals.css` and Tailwind (see `tailwind.config.ts`).

3. **Form submit (when wired)**  
   On submit, the form would POST to an API route (e.g. `/api/intake`). That route would use **Prisma** (`lib/prisma.ts`) to write to PostgreSQL. Any server state you fetch (e.g. with React Query) would call these same API routes from the client.

4. **Photo upload**  
   A client posts multipart/form-data to **`POST /api/upload`** (`src/app/api/upload/route.ts`). The route validates file size and type. When you’re ready, you’ll stream the file to **S3** (using `lib/s3.ts`) and push a job to **`src/backend/queue`** (BullMQ + Redis) for virus scanning. Workers created with `createVirusScanWorker` would run in a separate process or serverless function.

5. **Auth**  
   **NextAuth** is mounted at `/api/auth/*` (`src/app/api/auth/[...nextauth]/route.ts`). It uses the **Prisma adapter** and a **Credentials** provider (name/email/phone). Session is JWT-based; `session.user.id` is available in callbacks and in the client via `useSession()`. The extended types live in `src/types/next-auth.d.ts`.

6. **Backend services (placeholders)**  
   - **`src/backend/services/image.ts`** – Intended for **Sharp**: resize/compress uploads before S3.  
   - **`src/backend/services/pdf.ts`** – Intended for **pdf-lib**: generate grant PDFs.  
   Call these from API routes or queue workers when you implement them.

### Summary

| You want to…              | Use / look at…                                      |
|---------------------------|-----------------------------------------------------|
| Change the homepage UI    | `src/app/page.tsx`, `src/frontend/components`       |
| Add or change API routes   | `src/app/api/*`                                     |
| Read/write the database   | `lib/prisma.ts`, `prisma/schema.prisma`             |
| Handle auth (session, sign in/out) | `src/app/api/auth/[...nextauth]/route.ts`, `useSession` |
| Upload photos (validate → store → scan) | `src/app/api/upload/route.ts`, `lib/s3.ts`, `src/backend/queue` |
| Run background jobs       | `src/backend/queue` (BullMQ), Redis                  |
| Shared UI (buttons, inputs) | `src/frontend/components/ui`                      |
| Global styles / theme     | `src/app/globals.css`, `tailwind.config.ts`         |

## Scripts

- `npm run dev` – Dev server (Turbopack)
- `npm run build` / `npm run start` – Production
- `npm run db:generate` / `npm run db:push` / `npm run db:migrate` / `npm run db:studio` – Prisma
- `npm run test` / `npm run test:watch` – Jest + React Testing Library
- `npm run test:e2e` – Playwright E2E

## Tech stack

- **UI:** Tailwind CSS, shadcn/ui (Button, Input in `src/frontend/components/ui`)
- **Forms:** React Hook Form + Zod
- **Server state:** React Query
- **DB:** Prisma + PostgreSQL
- **Auth:** NextAuth.js (Credentials provider boilerplate)
- **Backend:** Placeholders for Sharp, PDF-lib; Redis-backed queues (BullMQ) for virus scan and AI jobs
- **Tests:** Jest + RTL (unit), Playwright (E2E)

## APIs

- `POST /api/upload` – Multipart form-data photo upload (validates file; S3 and virus-scan queue to be wired)
- `GET/POST /api/auth/[...nextauth]` – NextAuth

## Accessibility

- Focus visible styles and semantic HTML on the intake form.
- Aim for WCAG 2.1 Level AA; use the “Small Jobs Strategy” for incremental, senior-friendly changes.
