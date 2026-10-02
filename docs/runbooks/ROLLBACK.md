# Rollback Runbook

Application rollback and database recovery are separate decisions. Prefer the
smallest reversible change that restores safety.

## Decision gate

Rollback the application when the current deploy causes broad errors, auth or
tenant-boundary risk, failed core flows, or unacceptable performance and a
known-good artifact exists. Record the incident/release ID, current SHA,
target SHA, approver and database compatibility assessment.

Do not roll back blindly when the new release has already written data that an
older application cannot understand. In that case disable the affected path
and ship a forward compatibility fix.

## Application rollback

1. Confirm the target deployment previously passed production gates.
2. Compare environment variables and migration expectations between target and
   current releases.
3. Promote the known-good immutable Vercel deployment through the normal
   protected production workflow.
4. Verify `/api/health` returns the promoted SHA and database readiness.
5. Run remote public E2E and cron `--auth-only` smoke.
6. Validate login, tenant isolation and the incident-specific workflow.
7. Watch errors and heartbeat state through at least one normal interval.

## Database changes

- Never edit an already applied migration or run ad-hoc destructive down SQL.
- Additive schema is normally left in place during an application rollback.
- For incompatible schema behavior, create a reviewed forward-fix migration.
- If rows are corrupt or missing, stop writes and use the restore runbook; a
  code rollback does not restore data.

## Abort criteria

Stop the rollback and escalate when the target artifact is not verifiable,
expected migration readiness fails, environment values differ unexpectedly,
or the old code would write incompatible data. Preserve logs and choose a
forward fix or controlled restore.

## Completion record

Attach target/current SHAs, health output, smoke results, DB compatibility
decision, approvers, timestamps and remaining follow-up work to the incident or
release record.

