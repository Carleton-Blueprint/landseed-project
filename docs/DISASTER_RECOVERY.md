# Disaster Recovery

Status: **Neon is the chosen provider.** This document states the recovery
targets and how Neon meets them, so the handoff package has a real,
provider-accurate restore procedure to follow. A live restore drill is still
pending until a production Neon project is provisioned — see Verification
below.

## Targets

- **RTO (Recovery Time Objective): 4 hours** — time to have the application
  serving traffic again against a restored database after a declared
  incident.
- **RPO (Recovery Point Objective): 1 hour** — maximum acceptable data loss,
  measured as time between the last recoverable state and the incident.

## Why RPO needs more than daily backups

A once-a-day full backup alone caps RPO at ~24 hours, not 1 hour. Hitting 1
hour requires continuous point-in-time recovery (PITR): Neon retains the WAL
(write-ahead log) stream continuously rather than only taking periodic
snapshots, so a restore can target any timestamp the retained history
covers — not just whenever the last snapshot happened to run. Self-hosting
Postgres would require standing up `wal-g`/`pgBackRest` WAL archiving
ourselves to get the same guarantee.

## Plan tier requirements

Neon has no separate "backup" product — PITR retention window is a property
of the plan tier, and it's what determines how far back a restore can reach:

| Plan | PITR / restore window | Cost | Notes |
|---|---|---|---|
| Free | Up to 6 hours, capped at 1GB of change history | No PITR charge | Restore window is a rolling lookback, not a retention guarantee — the 1GB cap can silently shrink it under heavy write volume. Not sufficient for a 1h RPO commitment. |
| Launch | Up to 7 days, configurable | $0.20/GB-month for retained change history | Meets the 1h RPO target; 7-day window is short of the 30-day retention target below. |
| Scale | Up to 30 days, configurable | $0.20/GB-month for retained change history | Meets both the 1h RPO and 30-day retention targets. **This is the tier LandSeed needs provisioned** once a production project is created. |

Only root branches are billed for PITR storage — this matters if the team
later adopts Neon's branching for staging/preview environments, since child
branches don't add to the billed change history.

## How each target will be met

| Target | Mechanism |
|---|---|
| RPO ≤ 1h | Neon's continuous WAL-based PITR on the Scale tier (see above) — any point within the retention window is restorable, not just daily snapshots. |
| RTO ≤ 4h | Neon's restore-from-history operation itself completes in seconds (see Restore procedure below) — the 4h budget is dominated by repointing `DATABASE_URL`, redeploying, and smoke-testing, not by the restore. This hasn't been timed end-to-end against a real Neon project yet (see Verification). |
| 30-day retention | Scale tier's PITR window set to 30 days (configurable up to that cap). |
| Geographic redundancy | **Known gap, not covered by Neon.** A Neon project is pinned to a single region for its lifetime — there is no built-in cross-region replication or failover. PITR protects against data corruption/bad writes within that region, not a regional outage. If cross-region DR becomes a hard requirement, the only path is manually standing up logical replication to a second Neon project in another region (extra cost and an ongoing pipeline to maintain) — this is a follow-up decision for the team, not something the current plan provides by default. |

## Restore procedure

Neon has no separate restore-into-place step — restoring builds a **new
branch** at the target point, migrates the original branch's compute to it,
and renames it to the original branch's name, so connection strings don't
change. The pre-restore state isn't destroyed: it survives as a renamed
`{branch}_old_{timestamp}` branch.

1. **Identify the target recovery point.** Use the incident timeline to pick
   a timestamp (or LSN) just before the incident (favor slightly earlier over
   later — losing a few extra minutes of data beats restoring corrupted
   state).
2. **Restore the branch to that point.** Instant restore only works on root
   branches. Three equivalent ways to trigger it:
   - **Console:** open the branch → "Restore from history" tab → pick the
     timestamp or LSN → review → Restore.
   - **CLI:** `neon branches restore <target-branch> <source-branch>@<timestamp|lsn>`
   - **API:** `POST /projects/{project_id}/branches/{branch_id}/restore`
     with the timestamp or LSN.
   The operation itself completes in seconds — Neon rebuilds the branch at
   the matching LSN and moves compute over automatically.
3. **Validate the restored branch.** Spot-check row counts on a few core
   tables (`User`, `Project`, `Quote`, `AuditEvent`) and confirm the most
   recent expected records are present up to the target timestamp.
4. **Redeploy the application.** Since Neon reuses the original branch name
   and connection string on restore, `DATABASE_URL` typically doesn't need
   to change — but redeploy the app to clear any connection pools holding
   stale state, and confirm.
5. **Smoke-test.** Sign in, load a project, confirm the audit trail
   (`/api/admin/audit/verify`) still validates against the restored data.
6. **Post-incident:** record what was lost (the gap between the incident and
   the restored timestamp), and notify affected stakeholders per LandSeed's
   incident process. The pre-restore branch (`{branch}_old_{timestamp}`)
   stays available if anything needs to be recovered from it afterward.

## Verification

This procedure has **not yet been run as a live drill** — there's no
production Neon project provisioned yet. Once one exists on the Scale tier:
run a real restore drill (trigger a restore against a recent timestamp on a
non-production branch, time steps 2–5 end-to-end) to confirm the 4h RTO is
actually achievable given Neon's few-seconds restore time, and record the
result here.

Locally, the closest available check is restoring the `docker-compose`
Postgres from a `pg_dump` into a second local database and confirming row
counts match — useful for validating restore *mechanics*, but not a
substitute for a real Neon PITR drill.

## Related

- `TO-DO.md` (workspace root) — original provider decision entry (Neon vs.
  RDS) and the follow-up checklist this document implements.
