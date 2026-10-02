# Database Restore Runbook

Restore is a high-impact data operation. It requires an incident commander,
database owner, explicit production approval and a verified backup/PITR point.
Do not use restore as a substitute for an application rollback.

## Preconditions

- Define the affected tenant/data scope and the last known-good UTC time.
- Record current deploy SHA, migration ledger head and checksum output.
- Confirm backup retention, restore point availability and expected data-loss
  window (RPO) with the provider.
- Pause or isolate affected writers, webhooks and cron jobs. Record every pause.
- Preserve current DB and object-storage evidence before cutover.

## Rehearse in isolation

1. Restore to a separate, access-restricted Supabase project/database first.
2. Apply no new writes until schema and data are inspected.
3. Compare `schema_migrations` versions/checksums with the repository.
4. Validate critical row counts, foreign keys, tenant IDs, auth mappings,
   storage metadata and incident-specific records.
5. Run the RLS audit and application smoke against the isolated restore using
   temporary non-production credentials.
6. Decide whether full cutover or a reviewed, tenant-scoped data repair is safer.

## Production recovery

1. Announce the write freeze and confirm all owners are present.
2. Execute the provider-supported PITR/restore procedure for the approved point.
3. Rotate temporary connection credentials and update server environments only.
4. Run pending forward migrations through `npm run db:migrate`; never baseline
   an unverified restored schema.
5. Run `npm run check:migrations -- --database` and `npm run db:rls-audit`.
6. Verify `/api/health`, auth, tenant isolation, critical row counts, storage
   access and the incident-specific workflow.
7. Re-enable writers one at a time, then cron jobs and integrations, while
   monitoring error logs and heartbeat state.

## Validation evidence

Record restore point, provider operation ID, start/end UTC, approvers, observed
RPO, migration head/checksum, RLS result, before/after counts, smoke output and
any tenant-scoped reconciliation. Never include passwords, tokens or raw
personal data.

## Failed restore

Keep writes frozen, preserve the failed environment and do not repeatedly
overwrite production. Escalate to the provider, return traffic to the last
verified environment if safe, and reassess the restore point or repair plan.
