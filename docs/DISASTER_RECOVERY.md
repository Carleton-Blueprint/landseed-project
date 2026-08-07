# Disaster Recovery

Status: **provider-dependent, not yet finalized.** No production database is
provisioned yet (see `TO-DO.md`). This document states the *targets* and how
they'll be met once a provider is chosen, so the handoff package has a real
restore procedure to follow rather than nothing — but the provider-specific
steps below are generic until that decision lands.

## Targets

- **RTO (Recovery Time Objective): 4 hours** — time to have the application
  serving traffic again against a restored database after a declared
  incident.
- **RPO (Recovery Point Objective): 1 hour** — maximum acceptable data loss,
  measured as time between the last recoverable state and the incident.

## Why RPO needs more than daily backups

A once-a-day full backup alone caps RPO at ~24 hours, not 1 hour. Hitting 1
hour requires continuous point-in-time recovery (PITR) — i.e. the database
provider replaying transaction logs (WAL) up to a specific timestamp, not
just restoring the last nightly snapshot. Both Neon and RDS provide this
natively on appropriate plan tiers; self-hosting would require standing up
`wal-g`/`pgBackRest` WAL archiving ourselves. This is the deciding factor
behind the provider recommendation in `TO-DO.md` — see that entry for
current status.

## How each target will be met (once a provider is live)

| Target | Mechanism |
|---|---|
| RPO ≤ 1h | Provider-native continuous PITR (Neon or RDS), confirmed to be included at whatever plan tier is provisioned — not just daily snapshots. |
| RTO ≤ 4h | Provider restore-to-point-in-time into a new instance/branch, repoint `DATABASE_URL`, redeploy the app, smoke-test. Budget: ~30–60 min provider-side restore + ~15 min redeploy + verification — well inside 4h, but this hasn't been timed against a real restore yet (see Verification below). |
| 30-day retention | Provider backup/PITR retention window set to 30 days (tier-dependent — confirm during provider selection). |
| Geographic redundancy | Provider's cross-region backup replication, distinct from the primary database's region — confirm this is included at the chosen tier, not just cross-AZ (flagged in `TO-DO.md`). |

## Restore procedure (generic — finalize once a provider is chosen)

1. **Identify the target recovery point.** Use the incident timeline to pick
   a timestamp just before the incident (favor slightly earlier over later —
   losing a few extra minutes of data beats restoring corrupted state).
2. **Restore to a new instance, not in place.** Use the provider's
   restore-to-point-in-time flow (Neon: create a new branch from a
   timestamp; RDS: restore-from-snapshot/PITR to a new instance). Never
   restore over the live primary — validate first.
3. **Validate the restored instance.** Spot-check row counts on a few core
   tables (`User`, `Project`, `Quote`, `AuditEvent`) and confirm the most
   recent expected records are present up to the target timestamp.
4. **Repoint the application.** Update `DATABASE_URL` (and any read-replica
   config) to the restored instance, redeploy.
5. **Smoke-test.** Sign in, load a project, confirm the audit trail
   (`/api/admin/audit/verify`) still validates against the restored data.
6. **Cut over.** Once validated, promote the restored instance to primary
   (provider-specific step) and update DNS/connection strings permanently.
7. **Post-incident:** record what was lost (the gap between the incident and
   the restored timestamp) and notify affected stakeholders per LandSeed's
   incident process.

## Verification

This procedure has **not yet been run as a live drill** — there's no
production database to drill against. Once a provider is provisioned:
finalize the provider-specific steps above, then run a real restore drill
(restore a recent backup into a scratch instance, time it end-to-end) to
confirm the 4h RTO is actually achievable, and record the result here.

Locally, the closest available check is restoring the `docker-compose`
Postgres from a `pg_dump` into a second local database and confirming row
counts match — useful for validating restore *mechanics*, but not a
substitute for a real provider-level PITR drill.

## Related

- `TO-DO.md` (workspace root) — provider decision status and the
  cross-region/PITR tier caveats to confirm during that decision.
