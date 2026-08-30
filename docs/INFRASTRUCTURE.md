# Infrastructure Setup

This document describes how the Landseed application is deployed and what each
environment needs. The web application runs on two hosts: **staging on Netlify**
and **production on Vercel**. Backing services (database, Redis, storage,
workers) are shared infrastructure that both environments talk to.

> Confidential: internal operational documentation. Do not share outside the
> team. This document names environment variables but contains no secret
> values. Set all secrets directly in each provider's dashboard, never in this
> file or in the repository.

## 0. Current deployment (production)

| Thing | Value |
| --- | --- |
| Production URL | `https://landseed-inplace-production.vercel.app` (default Vercel URL — custom domain pending, §10) |
| Vercel team / project | `carleton-blueprint` / `landseed-inplace-production` |
| Neon project | `landseed-inplace-production`, region `us-east-2` (Ohio — free-tier default, close enough to Vercel's `iad1`/Virginia region that the difference is negligible) |
| Railway project | `successful-adaptation` (Railway's auto-generated name — never renamed, cosmetic only), workspace `Great Nnaji's Projects`, region `us-east4` (both Redis and ClamAV were moved here from Railway's Amsterdam default — see phase 1 of the deployment implementation log for why) |
| Railway services | `Redis` (public TCP proxy), `clamav` (private only), `worker` (runs `npm run worker:all`, sourced from this repo's `main` branch) |
| GitHub → Vercel connection | Connected via Vercel CLI (`vercel git connect`), not the dashboard's "Import Git Repository" flow — that one needs a `Carleton-Blueprint` org owner to grant Vercel's GitHub App repository access, still pending. Unclear whether the CLI's connection enables full auto-deploy-on-push or just repo metadata; not relied upon either way (see §10). |

## 1. Topology

```
                 Browser
                    |
        +-----------+-----------+
        |                       |
   Staging web             Production web
   (Netlify)                 (Vercel)
        |                       |
        +-----------+-----------+
                    |
        shared backing services
                    |
   +----------------+----------------+----------------+
   |                |                |                |
 Postgres         Redis            R2 / S3        External APIs
 (Prisma)        (Railway)        (Cloudflare)    Resend, OpenAI,
                    |                              BuilderTrend, SERP
              Workers (Railway)
              npm run worker:all
```

- **Web application** (Next.js App Router): serves pages and API routes. Fast,
  request-scoped work only. Enqueues background jobs; it does not process them.
- **Workers** (Railway): a single always-on process (`worker:all`) that consumes
  every BullMQ queue and performs the slow or external work (email, AI, virus
  scan, BuilderTrend transfer, scheduled sweeps). See
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

### Production: Vercel

Vercel detects its own `VERCEL` environment variable at runtime, and Auth.js
uses that to trust the host automatically. This removes the staging-only step:

- `AUTH_TRUST_HOST` is **not required** on Vercel. Setting it does no harm, but
  it is unnecessary.
- **`AUTH_URL` / `NEXTAUTH_URL` must be set explicitly, even on the default
  `*.vercel.app` URL** — this contradicts what an earlier version of this doc
  assumed ("auto-inferred, set only for a custom domain"). Verified wrong
  during phase 4 testing: without it, the post-sign-in redirect and the
  `authjs.callback-url` cookie both pointed at `http://localhost:3000` in
  real production, not the actual deployment URL — likely specific to the
  `next-auth@5.0.0-beta.28` version this app pins. Set both `AUTH_URL` and
  `NEXTAUTH_URL` (the app code reads the latter as a fallback in several
  places) to the real deployment URL, custom domain or not.

Vercel build settings:

| Setting | Value |
| --- | --- |
| Framework preset | Next.js |
| Build command | `prisma generate && next build` (or the default, plus a migrate step, see [section 6](#6-database-and-migrations)) |
| Node version | 20 or newer |

### Netlify vs Vercel: what actually differs

| Concern | Netlify (staging) | Vercel (production) |
| --- | --- | --- |
| Auth.js host trust | `AUTH_TRUST_HOST=true` required | automatic, not needed |
| Base URL | set `NEXTAUTH_URL` explicitly | auto-inferred; set only for custom domain |
| `NEXTAUTH_SECRET` | required | required |
| Serverless function limits | short timeouts; long tasks belong in workers | short timeouts; long tasks belong in workers |
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
| Redis (Railway) | BullMQ queues and login rate limiting | must use the **public** Railway TCP proxy host, not `*.railway.internal`, so Netlify and Vercel can reach it |
| R2 / S3 (Cloudflare) | photo and document storage | bucket plus access keys |
| Resend | transactional email | used by the email worker, not the web tier |
| OpenAI | photo analysis and image generation | used by the AI worker |
| BuilderTrend | construction management integration | outbound transfer plus inbound status webhook |
| SERP API | grant discovery research | optional; only if that feature is enabled |
| ClamAV | virus scanning of uploads | Railway sidecar next to the worker service, reached over Railway's private network — see [ClamAV reachability](#clamav-virus-scanning) |

### Redis reachability

Redis is the hand-off point between the web tier and the workers. Both sides
must reach the same Redis instance over its public endpoint. In Railway, enable
the Redis service TCP Proxy and use `REDIS_PUBLIC_URL` (host ends in
`.proxy.rlwy.net` on a high port, not `6379`). The internal
`redis.railway.internal` host resolves only inside Railway and will fail from
Netlify or Vercel with `ENOTFOUND`.

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

Set these in the Netlify and Vercel dashboards. The canonical list of names
lives in `.env.example`. Values differ per environment (staging vs production
credentials and URLs); the crypto keys noted below must match across the web
tier and the worker service.

### Required for the web tier

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection (per environment) |
| `REDIS_URL` | Redis public proxy URL (per environment) |
| `NEXTAUTH_SECRET` | Auth.js session signing secret |
| `AUTH_TRUST_HOST` | `true` on Netlify only; omit on Vercel |
| `NEXTAUTH_URL` | full site URL; required on Netlify, optional on Vercel |
| `APP_BASE_URL` | base URL used to build links in notifications and emails |
| `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | photo and document uploads from the upload route |
| `AUDIT_SIGNING_PRIVATE_KEY`, `AUDIT_SIGNING_PUBLIC_KEY`, `AUDIT_SIGNING_KEY_ID` | signing of the hash-chained audit log (login and account events are written from the web tier) |
| `MFA_ENCRYPTION_KEY` | encryption of admin MFA secrets (enrollment and verification happen in the web tier) |
| `BUILDERTREND_WEBHOOK_SECRET` | validates inbound BuilderTrend status webhooks |

### Feature flags and optional web-tier settings

| Variable | Effect |
| --- | --- |
| `EMAIL_PROVIDER` | defaults to `resend`; leave unset unless changing providers |
| `GRANT_DISCOVERY_AI_MODEL` | select the grant-discovery model |
| `PHOTO_ANALYSIS_AI_MODEL` | select the photo-analysis model |
| `PRICING_DEBUG`, `PHOTO_ANALYSIS_DEBUG`, `GRANT_DISCOVERY_DEBUG` | debug logging; leave unset in production |
| `*_MOCK_*`, `BUILDERTREND_MOCK_FAIL`, `GRANT_DISCOVERY_DEV_MOCK_GET` | test and mock flags; never set in production |

Variables such as `RESEND_API_KEY`, `EMAIL_FROM`, `OPENAI_API_KEY`,
`OPENAI_ORG_ID`, `SERP_API_KEY`, `SERP_API_COST_PER_QUERY`, and `CLAMAV_HOST` /
`CLAMAV_PORT` are consumed by the workers, not by the web tier. They belong on
the worker service (see [section 7](#7-workers-shared)). Setting them on the web
host is harmless but not required.

## 5. Secrets handling

- Set every secret in the provider dashboard (Netlify, Vercel, Railway). Never
  commit secret values, and never paste them into chat, tickets, or this file.
- Use **separate** credentials for staging and production (database, Redis, R2,
  API keys). Staging should never be able to read or write production data.
- If a secret is ever exposed, rotate it at the source and update every
  environment that uses it.
- The following are especially sensitive and their exposure requires rotation:
  `NEXTAUTH_SECRET`, `AUDIT_SIGNING_PRIVATE_KEY`, `MFA_ENCRYPTION_KEY`,
  `R2_SECRET_ACCESS_KEY`, `RESEND_API_KEY`, `OPENAI_API_KEY`, `DATABASE_URL`,
  and `BUILDERTREND_WEBHOOK_SECRET`.

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

The workers are not part of the Netlify or Vercel deployment. Serverless
functions cannot run long tasks or timers, so the workers run as a single
always-on process on Railway.

- Start command: `npm run worker:all` (runs `src/backend/queue/allWorkers.ts`,
  which starts every queue consumer and the scheduled sweeps in one process).
- The worker service needs the shared backing-service variables (`DATABASE_URL`,
  `REDIS_URL`) plus the ones the web tier does not use: `RESEND_API_KEY`,
  `EMAIL_FROM`, `OPENAI_API_KEY` (and optionally `OPENAI_ORG_ID`),
  `SERP_API_KEY`, `CLAMAV_HOST`, `CLAMAV_PORT`, and the R2 variables.
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

Production (Vercel):

- [ ] Env vars set (no `AUTH_TRUST_HOST` needed)
- [ ] `NEXTAUTH_SECRET` set; `AUTH_URL`/`NEXTAUTH_URL` set to the real
      deployment URL — **required even on the default `*.vercel.app` URL**,
      not just for custom domains (see the correction in
      [section 2](#2-web-application-hosting))
- [ ] `REDIS_URL` points at the production public Redis host
- [ ] Migrations applied to the production database, after a snapshot
- [ ] Worker service running `worker:all` against production Redis and Postgres
- [ ] Crypto keys (`AUDIT_SIGNING_*`, `MFA_ENCRYPTION_KEY`) match between the
      Vercel app and the production worker service
- [ ] Sign up, sign in, and a verification email all succeed

## 10. Open decisions

### Pending a LandSeed response

These are blocked on LandSeed and affect what still needs to change in this
document once resolved. Don't let production deployment wait on them —
proceed with the fallback in each item and revisit once LandSeed responds.

- **Production database ownership (Neon).** Either we create it under our own
  account now and transfer at handoff, or LandSeed creates it and adds us as
  collaborators. Fallback: proceed under our own account so deployment isn't
  blocked; update the Postgres row in [section 3](#3-backing-services-shared)
  once ownership is settled.
- **Custom domain (app.landseed.ca).** Needs LandSeed to add DNS records
  (CNAME/A plus TXT verification) once we have exact values from Vercel.
  Fallback: production stays on the default `*.vercel.app` URL. Add a "Custom
  domain" subsection under [section 2](#2-web-application-hosting) once DNS is
  live, including the `AUTH_URL` pin called out there.
- **Resend domain access.** Blocked on LandSeed providing either access to
  their own Resend account, or a sending domain plus DNS access. Fallback:
  production email stays on the Resend sandbox sender, which can only deliver
  to our own registered address — not real client inboxes. Add SPF/DKIM/DMARC
  setup notes to [section 3](#3-backing-services-shared) once the domain is
  confirmed.

### Pending a Blueprint org owner

Different responsible party than the LandSeed items above — this is blocked
on someone with Owner role on the `Carleton-Blueprint` GitHub org, not on
LandSeed. Both items are quick once someone with access is available, so
handle them together in one sitting rather than one at a time.

**Update, 2026-08-28 (ticket 3, PR #130):** the auto-deploy-on-push question
below is no longer unconfirmed — confirmed live. Pushing PR #130's branch
produced a real Vercel "Preview" deployment via the GitHub PR checks, so the
CLI-based connection (`vercel git connect`) does enable full
auto-deploy-on-push, not just repo metadata. That means the Production
Branch flip is no longer a hypothetical precaution — it is currently live
and Production Branch is still `main`, so **merging any PR to `main` right
now deploys straight to production with no staging gate**. PR #130 is being
merged with this understood; flip the Production Branch setting as soon as
an org owner is available, ideally before the next merge after that.

- **Grant Vercel's GitHub App repository access.** The dashboard's "Import
  Git Repository" flow fails with "This action must be performed by an
  organization owner" — granting a third-party GitHub App org-wide repo
  access is GitHub-Owner-gated, not a Vercel permission. When someone with
  Owner role does this, have them pick **"Only select repositories"** and
  choose just `landseed-project`, not "All repositories." Worked around for
  now via `vercel link`/`vercel git connect` (CLI), which connected the repo
  through a different path that didn't hit this gate — and (per the update
  above) that path does enable full auto-deploy-on-push, confirmed via
  PR #130.
- **Flip Vercel's Production Branch from `main` to `production`.** A
  `production` branch already exists (created off `origin/main`, pushed to
  origin) so this is ready to go — the dashboard setting itself
  (Project Settings → Git → Production Branch) is gated behind the same
  GitHub-owner access as the item above, so do both at once. This is no
  longer a "before relying on auto-deploy-on-push" precaution — auto-deploy
  is confirmed active now, so every push to `main` deploys to production
  until this flips. Highest-priority item in this section as of 2026-08-28.

  **Update, 2026-08-30:** confirmed gated, not just theorized. On the
  current (non-owner) account, Project Settings → Git shows no Production
  Branch control at all — not greyed out, just absent from the page
  entirely (only "Connected Git Repository," PR/commit comment toggles,
  Git Commits status settings, LFS, and Deploy Hooks render). Also tried
  the API path directly: `GET /v9/projects/{idOrName}` confirms the field
  is `link.productionBranch` (currently `"main"`), but `PATCH` doesn't
  accept `link` as a body field (`400: should NOT have additional property
  'link'`) — the correct body shape is unconfirmed (top-level
  `productionBranch` was the next thing to try, but wasn't completed this
  session), and untested whether a non-owner token would 403 on it anyway.
  Bottom line unchanged: needs an org owner, dashboard is the more direct
  path once they're granted access, don't burn more time on the API route.
  `production` is now 9+ commits behind `main` (missing PR #130 and the
  worker shutdown-handler consolidation, PR #131) — remember to merge
  `main` → `production` right after the flip, or prod will briefly regress
  to an older build.

### Deferred to handoff

Not blocking anything today — Blueprint's accounts absorb these during
development — but they're real recurring costs LandSeed will own after
transfer, so they need to land in the ticket 2 handoff package (service
accounts and credentials inventory) rather than get forgotten.

- **Railway billing.** Redis, the worker, and the ClamAV sidecar all live in a
  Railway project under Blueprint's account. Railway's free Trial doesn't
  support public networking (needed for Redis's TCP proxy) — it requires
  upgrading to the Hobby plan (~$5/mo base, plus usage) with a payment method
  on file. Same ownership question as Neon: keep billing through Blueprint
  until final handoff, or have LandSeed create their own Railway account now
  and add us as collaborators. At handoff, document actual plan/tier and
  monthly cost here, alongside the equivalent for Vercel, Neon, R2, Resend,
  OpenAI, and SerpAPI.
- **SerpAPI is on the free tier.** Reused as-is for the production worker for
  now (low stakes while there's no real traffic), but the free tier has a low
  monthly search cap — needs upgrading to a paid plan before real client
  traffic depends on grant-discovery search results, or requests will start
  silently failing once the cap is hit. Flag this explicitly at handoff, not
  just as a line item.
- **OpenAI is already LandSeed-owned**, not Blueprint's — the key in use is
  billed directly to LandSeed's account. Worth noting in the inventory as the
  one exception to "everything's under Blueprint's account for now."
- **Vercel team.** Created fresh (`carleton-blueprint`) under Blueprint's
  account — no prior team existed. Plan tier at creation time wasn't
  explicitly confirmed (no payment prompt appeared, unlike Railway's Hobby
  gate, suggesting it's still on Vercel's free tier) — verify and record the
  actual plan here before handoff, same as the others.
- **Cloudflare R2 (production bucket) is a separate Cloudflare account**
  from the one holding the dev/local bucket — confirmed by comparing account
  IDs, not assumed. One more account to include in the handoff inventory
  alongside Vercel/Neon/Railway, distinct from whatever account dev R2
  already lived under.

## Related documents

- `docs/DISASTER_RECOVERY.md` for backup and restore targets and procedure.
