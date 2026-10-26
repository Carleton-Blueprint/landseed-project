# Infrastructure Setup

This document describes how the Landseed application is deployed and what each
environment needs. The web application runs on two hosts: **staging on Netlify**
and **production on Railway**. Backing services (database, Redis, storage,
workers) are shared infrastructure that both environments talk to.

> Confidential: internal operational documentation. Do not share outside the
> team. This document names environment variables but contains no secret
> values. Set all secrets directly in each provider's dashboard, never in this
> file or in the repository.

## 0. Current deployment (production)

| Thing | Value |
| --- | --- |
| Production URL | `https://landseed-project-production.up.railway.app` (default Railway URL — custom domain pending, §10) |
| Neon project | `landseed` (ID `cold-star-48934454`), owned by LandSeed's Neon org, region `us-east-2` (Ohio), **Free plan**. Branches: `production` (Railway web app + worker) and `dev` (local development / tests). `DATABASE_URL` = pooled string, `DIRECT_URL` = direct string (Prisma migrations). Replaced the stopgap project on a personal account as of 2026-10-04. |
| Railway project | `landseed-inplace-production`, in LandSeed's Railway workspace. Hosts everything in production — the old Vercel project/team was deleted. |
| Railway services | `landseed-project` (Next.js web app, `npm run build` / `npm start`), `worker` (runs `npm run worker:all`), `clamav` (private only), `Redis` (public TCP proxy) |
| Cloudflare R2 | LandSeed's Cloudflare account, buckets `landseed-prod` (Railway) and `landseed-dev` (local development) |

## 1. Topology

```
                 Browser
                    |
        +-----------+-----------+
        |                       |
   Staging web             Production web
   (Netlify)                (Railway)
        |                       |
        +-----------+-----------+
                    |
        shared backing services
                    |
   +----------------+----------------+----------------+
   |                |                |                |
 Postgres         Redis            R2 / S3        External APIs
 (Prisma)        (Railway)        (Cloudflare)    Resend, OpenAI,
                    |                              SERP
              Workers (Railway)
              npm run worker:all
```

- **Web application** (Next.js App Router): serves pages and API routes. Fast,
  request-scoped work only. Enqueues background jobs; it does not process them.
- **Workers** (Railway): a single always-on process (`worker:all`) that consumes
  every BullMQ queue and performs the slow or external work (email, AI, virus
  scan, scheduled sweeps). See
  [Worker setup](#7-workers-shared).
- **Backing services**: Postgres, Redis, and R2 are shared by both web
  environments and the workers.

## 2. Web application hosting

Both environments run the same Next.js build. The important operational
difference is how each platform handles Auth.js (NextAuth v5) host trust.

### Staging: Netlify

Netlify serves the app from serverless functions. Auth.js does **not**
auto-trust the request host on Netlify, so it must be told to:

- Set `AUTH_TRUST_HOST=true`. Without it, `GET /api/auth/session` returns a 500
  with `UntrustedHost` and sign-in and the session-aware UI break.
- Set `NEXTAUTH_URL` (or `AUTH_URL`) to the full staging URL, for example
  `https://<staging-site>.netlify.app`.

Netlify build settings:

| Setting | Value |
| --- | --- |
| Build command | `npm run build` (runs `prisma generate && next build`) |
| Node version | 20 or newer |
| Functions | default (Next.js adapter) |

### Production: Railway

The web app runs as a long-lived Node server (`next start`) in the Railway
service `landseed-project`, alongside the worker, ClamAV and Redis services in
the same project.

- **`AUTH_URL` / `NEXTAUTH_URL` must be set explicitly**, including
  `https://`. Without them, the post-sign-in redirect and the
  `authjs.callback-url` cookie point at `http://localhost:3000` (seen in
  real production, likely specific to the pinned `next-auth@5.0.0-beta.28`).
  A bare hostname with no `https://` throws `TypeError: Invalid URL` and 500s
  every authed page. Set both (the app code reads `NEXTAUTH_URL` as a
  fallback in several places), plus `APP_BASE_URL`.
- `AUTH_TRUST_HOST` is **not required**: Auth.js trusts the host whenever
  `AUTH_URL` is set (`@auth/core` `setEnvDefaults`). Setting it does no harm.
- **Public domain port:** the Railway public domain's target port must match
  the port Next.js listens on (Railway assigns `8080`). A mismatch shows
  "Application failed to respond" / 502 even though the logs say Ready.

Railway build settings (`landseed-project` service):

| Setting | Value |
| --- | --- |
| Build command | `npm run build` (runs `prisma generate && next build`; no migrate step, see [section 6](#6-database-and-migrations)) |
| Start command | `npm start` (`next start`) |
| Node version | 20 or newer |

### Netlify vs Railway: what actually differs

| Concern | Netlify (staging) | Railway (production) |
| --- | --- | --- |
| Auth.js host trust | `AUTH_TRUST_HOST=true` required | automatic once `AUTH_URL` is set |
| Base URL | set `NEXTAUTH_URL` explicitly | set `AUTH_URL`/`NEXTAUTH_URL` explicitly, with `https://` |
| `NEXTAUTH_SECRET` | required | required |
| Runtime | serverless functions with short timeouts | long-lived Node server; long tasks still belong in workers |
| Everything else (env vars, backing services) | identical | identical |

The rest of the configuration (all backing services and every other environment
variable below) is the same across both hosts. Only the auth host-trust handling
and the base URL differ.

## 3. Backing services (shared)

These are shared by both web environments and by the workers. Use separate
instances per environment (a staging database and Redis, a production database
and Redis) so staging traffic never touches production data.

| Service | Purpose | Notes |
| --- | --- | --- |
| Postgres | primary datastore (Prisma) | connection string in `DATABASE_URL` |
| Redis (Railway) | BullMQ queues and login rate limiting | must use the **public** Railway TCP proxy host, not `*.railway.internal`, so Netlify can reach it |
| R2 / S3 (Cloudflare) | photo and document storage | bucket plus access keys |
| Resend | transactional email | used by the email worker, not the web tier |
| OpenAI | photo analysis and image generation | used by the AI worker |
| SerpAPI (LandSeed account) | material pricing (Google Shopping) for estimates | **required** — `SERP_API_KEY` on both the worker and the web app; without it estimates can't price materials |
| ClamAV | virus scanning of uploads | Railway sidecar next to the worker service, reached over Railway's private network — see [ClamAV reachability](#clamav-virus-scanning) |

### Redis reachability

Redis is the hand-off point between the web tier and the workers. Both sides
must reach the same Redis instance over its public endpoint. In Railway, enable
the Redis service TCP Proxy and use `REDIS_PUBLIC_URL` (host ends in
`.proxy.rlwy.net` on a high port, not `6379`). The internal
`redis.railway.internal` host resolves only inside Railway and will fail from
Netlify with `ENOTFOUND`.

### ClamAV (virus scanning)

Decision: run ClamAV as a sidecar container in the same Railway project as the
worker service, rather than replacing it with a hosted scanning API. This
keeps the existing `clamscan` / `CLAMAV_HOST` integration unchanged and avoids
a code change during the production push.

- Deploy a ClamAV daemon image (e.g. `clamav/clamav`) as a second Railway
  service in the same project as the worker.
- Only the virus-scan worker talks to ClamAV — unlike Redis, no web host ever
  reaches it — so Railway's private network is sufficient. Point `CLAMAV_HOST`
  at the sidecar's internal Railway hostname (`<service-name>.railway.internal`),
  not the public proxy.
- `CLAMAV_PORT` stays `3310` (ClamAV's default `clamd` port).
- Run one ClamAV sidecar per environment (staging, production), matching the
  one-worker-per-environment pattern in [section 7](#7-workers-shared).
- Freshclam (virus definition updates) runs inside the sidecar container on
  its own schedule; no separate service needed.

## 4. Environment variables (web application)

Set these in the Netlify dashboard (staging) and on the Railway
`landseed-project` service (production). The canonical list of names
lives in `.env.example`. Values differ per environment (staging vs production
credentials and URLs); the crypto keys noted below must match across the web
tier and the worker service.

### Required for the web tier

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection (per environment) |
| `REDIS_URL` | Redis public proxy URL (per environment) |
| `NEXTAUTH_SECRET` | Auth.js session signing secret |
| `AUTH_TRUST_HOST` | `true` on Netlify only; not needed on Railway |
| `AUTH_URL`, `NEXTAUTH_URL` | full site URL including `https://`; required on both hosts |
| `APP_BASE_URL` | base URL used to build links in notifications and emails |
| `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | photo and document uploads from the upload route. All four are required; a missing account ID shows up as `ENOTFOUND .r2.cloudflarestorage.com` |
| `AUDIT_SIGNING_PRIVATE_KEY`, `AUDIT_SIGNING_PUBLIC_KEY`, `AUDIT_SIGNING_KEY_ID` | signing of the hash-chained audit log (login and account events are written from the web tier) |
| `MFA_ENCRYPTION_KEY` | encryption of admin MFA secrets (enrollment and verification happen in the web tier) |

### Feature flags and optional web-tier settings

| Variable | Effect |
| --- | --- |
| `EMAIL_PROVIDER` | defaults to `resend`; leave unset unless changing providers |
| `GRANT_DISCOVERY_AI_MODEL` | select the grant-discovery model |
| `PHOTO_ANALYSIS_AI_MODEL` | select the photo-analysis model |
| `PRICING_DEBUG`, `PHOTO_ANALYSIS_DEBUG`, `GRANT_DISCOVERY_DEBUG` | debug logging; leave unset in production |
| `*_MOCK_*`, `GRANT_DISCOVERY_DEV_MOCK_GET` | test and mock flags; never set in production |

Variables such as `RESEND_API_KEY`, `EMAIL_FROM`, `OPENAI_API_KEY`,
`OPENAI_ORG_ID`, `SERP_API_COST_PER_QUERY`, and `CLAMAV_HOST` /
`CLAMAV_PORT` are consumed by the workers, not by the web tier. (`SERP_API_KEY`
is the exception — the web tier also calls pricing, e.g. `/api/pricing` and
quote overrides, so it must be set on both.) They belong on
the worker service (see [section 7](#7-workers-shared)). Setting them on the web
host is harmless but not required.

## 5. Secrets handling

- Set every secret in the provider dashboard (Netlify, Railway). Never
  commit secret values, and never paste them into chat, tickets, or this file.
- Use **separate** credentials for staging and production (database, Redis, R2,
  API keys). Staging should never be able to read or write production data.
- If a secret is ever exposed, rotate it at the source and update every
  environment that uses it.
- The following are especially sensitive and their exposure requires rotation:
  `NEXTAUTH_SECRET`, `AUDIT_SIGNING_PRIVATE_KEY`, `MFA_ENCRYPTION_KEY`,
  `R2_SECRET_ACCESS_KEY`, `RESEND_API_KEY`, `OPENAI_API_KEY`, and `DATABASE_URL`.

## 6. Database and migrations

The build script runs `prisma generate` only. It does **not** apply migrations,
so the database schema does not update on its own when you deploy. Applying
migrations is a separate, deliberate step.

Apply pending migrations to an environment with:

```bash
npx prisma migrate deploy
```

Guidance:

- Run it against the target environment's `DATABASE_URL` (staging or
  production), from a trusted context, by an authorized team member.
- Take a database snapshot before applying to production, so you can roll back.
- Run `npx prisma migrate status` first to see what is pending and to detect
  drift before applying.
- To keep schema in sync automatically, add `prisma migrate deploy` to the
  deploy pipeline (for example a build or release command of
  `prisma generate && prisma migrate deploy && next build`), but only once the
  build environment has the target `DATABASE_URL` available and you have
  validated the first manual run.

## 7. Workers (shared)

The workers run separately from the web app, as a single always-on process in
the Railway `worker` service. (Netlify's serverless functions can't run long
tasks or timers, and in production the worker is kept separate from the
`landseed-project` web service so slow jobs never compete with requests.)

- Start command: `npm run worker:all` (runs `src/backend/queue/allWorkers.ts`,
  which starts every queue consumer and the scheduled sweeps in one process).
- The worker service needs the shared backing-service variables (`DATABASE_URL`,
  `REDIS_URL`) plus the ones the web tier does not use: `RESEND_API_KEY`,
  `EMAIL_FROM`, `OPENAI_API_KEY` (and optionally `OPENAI_ORG_ID`),
  `SERP_API_KEY`, `CLAMAV_HOST`, `CLAMAV_PORT`, and the R2 variables (the
  virus-scan worker downloads each upload from R2 to scan it and deletes it
  if infected).
- `APP_BASE_URL` and `NEXTAUTH_URL` must be the production `https://` URL on
  the worker too, or every link in worker-sent emails points at localhost.
- **Crypto keys must match the web tier.** `AUDIT_SIGNING_PRIVATE_KEY`,
  `AUDIT_SIGNING_PUBLIC_KEY`, `AUDIT_SIGNING_KEY_ID`, and `MFA_ENCRYPTION_KEY`
  must be identical on the worker service and the web host for the same
  environment. The audit log is a hash chain; mismatched signing keys corrupt
  verification.
- Run a separate worker service per environment, each pointed at that
  environment's Redis and Postgres.

## 8. Cross-cutting requirements

Independent of host, every environment needs all of the following to be true:

1. Redis is reachable from the web tier and the workers over its public host.
2. The same environment's web host and worker service share identical
   `AUDIT_SIGNING_*` and `MFA_ENCRYPTION_KEY` values.
3. Database migrations have been applied (`prisma migrate deploy`).
4. `NEXTAUTH_SECRET` is set. On Netlify, `AUTH_TRUST_HOST=true` is also set.
5. Staging and production use fully separate credentials and data stores.

## 9. Deploy checklist

Staging (Netlify):

- [ ] Env vars set, including `AUTH_TRUST_HOST=true` and `NEXTAUTH_URL`
- [ ] `REDIS_URL` points at the public Railway proxy host
- [ ] Migrations applied to the staging database
- [ ] Worker service running `worker:all` against staging Redis and Postgres
- [ ] Sign up, sign in, and a verification email all succeed

Production (Railway):

- [ ] Env vars set on `landseed-project` (no `AUTH_TRUST_HOST` needed)
- [ ] `NEXTAUTH_SECRET` set; `AUTH_URL`/`NEXTAUTH_URL`/`APP_BASE_URL` set to
      the real `https://` deployment URL on both `landseed-project` and
      `worker` (see [section 2](#2-web-application-hosting))
- [ ] Public domain's target port matches the port Next.js listens on
- [ ] `REDIS_URL` points at the production public Redis host
- [ ] Migrations applied to the production database, after a snapshot
- [ ] Worker service running `worker:all` against production Redis and Postgres
- [ ] Crypto keys (`AUDIT_SIGNING_*`, `MFA_ENCRYPTION_KEY`) match between the
      `landseed-project` and `worker` services
- [ ] All four R2 variables set on both services; a test upload lands in
      `landseed-prod` and the worker logs `File is clean`
- [ ] Sign up, sign in, and a verification email all succeed

## 10. Open decisions

### Pending a LandSeed response

These are blocked on LandSeed and affect what still needs to change in this
document once resolved. Don't let production deployment wait on them —
proceed with the fallback in each item and revisit once LandSeed responds.

- ~~**Production database ownership (Neon).**~~ **Resolved 2026-10-04:**
  LandSeed created the Neon project and added us as collaborators; production
  now runs on it (see the Neon row in the summary table). Still open: the
  project is on the **Free plan** (≈6h restore window) — LandSeed needs to
  upgrade to Scale to meet the targets in `DISASTER_RECOVERY.md`.
- **Custom domain (app.landseed.ca).** Needs LandSeed to add DNS records
  (CNAME plus any verification record) once we have exact values from
  Railway (`landseed-project` service → Settings → Networking → Custom
  Domain). Fallback: production stays on the default `*.up.railway.app` URL. Add a "Custom
  domain" subsection under [section 2](#2-web-application-hosting) once DNS is
  live, including the `AUTH_URL` pin called out there.
- **Resend domain access.** Blocked on LandSeed providing either access to
  their own Resend account, or a sending domain plus DNS access. Fallback:
  production email stays on the Resend sandbox sender, which can only deliver
  to our own registered address — not real client inboxes. Add SPF/DKIM/DMARC
  setup notes to [section 3](#3-backing-services-shared) once the domain is
  confirmed.

### Deploy pipeline

The Vercel-era items that used to be here (granting Vercel's GitHub App repo
access, flipping Vercel's Production Branch to `production`) are obsolete:
the Vercel project was deleted when production moved to Railway.

- **Confirm which branch each Railway service deploys from** (service →
  Settings → Source) and whether auto-deploy on push is on. If both deploy
  from `main`, every merge to `main` goes straight to production with no
  staging gate — decide whether to point them at a `production` branch
  instead.

### Deferred to handoff

Not blocking anything today — Blueprint's accounts absorb these during
development — but they're real recurring costs LandSeed will own after
transfer, so they need to land in the ticket 2 handoff package (service
accounts and credentials inventory) rather than get forgotten.

- **Railway billing.** The web app, worker, ClamAV and Redis all live in the
  `landseed-inplace-production` project in LandSeed's Railway workspace.
  Public networking (needed for Redis's TCP proxy and the web app's domain)
  requires a paid plan (Hobby, ~$5/mo base plus usage) — confirm whose
  payment method is on file. At handoff, document actual plan/tier and
  monthly cost here, alongside the equivalent for Neon, R2, Resend, OpenAI,
  and SerpAPI.
- **SerpAPI now runs on LandSeed's account** (as of 2026-10-04; key set on
  both Railway services). It powers material pricing for every estimate, so
  the monthly search cap matters: once it's hit, pricing lookups fail. Confirm
  LandSeed's plan covers expected volume before real client traffic, and
  keep `SERP_API_COST_PER_QUERY` in sync with the plan's per-search cost.
- **OpenAI is already LandSeed-owned**, not Blueprint's — the key in use is
  billed directly to LandSeed's account.
- **Cloudflare R2 is on LandSeed's Cloudflare account** (buckets
  `landseed-prod` and `landseed-dev`; access keys from LandSeed, shared via
  Bitwarden). A personal card is temporarily on that account's billing until
  LandSeed replaces it — include in the handoff inventory.

## Related documents

- `docs/DISASTER_RECOVERY.md` for backup and restore targets and procedure.
