# Incident Response Runbook

## Start an incident

Declare an incident when confidentiality, tenant isolation, authentication,
payments, data integrity or production availability may be affected. Create a
private incident channel/timeline and assign:

- Incident commander: owns severity, decisions and handoffs.
- Operations lead: containment, deploy and infrastructure actions.
- Security/data lead: exposure scope, evidence and regulatory assessment.
- Communications lead: internal/customer updates.
- Scribe: immutable UTC timeline, commands, approvals and outcomes.

Suggested severity:

- SEV-1: active data exposure, auth/service-role compromise, destructive data
  loss or broad outage.
- SEV-2: material tenant impact, payment failure or degraded core workflow with
  no safe workaround.
- SEV-3: limited impact with a safe workaround and no evidence of exposure.

## First 15 minutes

1. Record detection time, deploy SHA, environment and reporter.
2. Preserve evidence before changing state: request IDs, sanitized logs,
   relevant audit rows, health output and deployment metadata.
3. Stop the bleeding with the narrowest reversible control: disable the
   affected integration/route, pause a cron, revoke a session, or roll back the
   application. Do not delete evidence.
4. If a secret may be exposed, revoke/rotate it at the provider, update server
   environments and redeploy. Never paste the old/new value into the timeline.
5. If tenant isolation may be broken, suspend the affected path and run the RLS
   audit only after evidence is preserved.

### Secret found in Git history

Treat a historical secret as compromised even if the file was later deleted.
Record only its redacted fingerprint, commit, path and rule; never copy the
secret into an issue or incident note. Remediation order is mandatory:

1. Revoke/rotate the credential at its provider first and deploy the replacement.
2. Confirm the old credential can no longer authenticate.
3. Prepare a reviewed history rewrite that removes the secret from every ref.
4. Coordinate protected-branch changes and the required force-push explicitly.
5. Invalidate cached artifacts where possible and require contributors to make
   a fresh clone instead of merging old history back.
6. Re-run full-history gitleaks across all reachable refs.

Do not add a real credential finding to `.gitleaksignore`. Only an exact,
demonstrably synthetic fixture fingerprint may be ignored; path- or rule-wide
exceptions are too broad.

## Investigation

- Build an exact UTC event timeline and identify the first affected release.
- Compare deploy SHA and `/api/health` migration readiness.
- Determine affected tenants, row/object types and read/write operations.
- Review auth, platform audit, ticket attachment, webhook and provider logs as
  applicable. Export only the minimum evidence and encrypt access.
- Distinguish confirmed impact from hypothesis in every update.

## Recovery

1. Choose code rollback, forward fix or data restore using the linked runbooks.
2. Require peer approval for DB, credential and production-routing actions.
3. Validate health, tenant isolation, auth, affected workflows and cron guards.
4. Monitor at least one normal processing interval before resolving.
5. Communicate scope and recovery without exposing security details that create
   additional risk.

## Closeout

Within the agreed review window, document root cause, contributing controls,
customer/data impact, detection gap, actions with owners/dates and evidence of
completion. Rotate temporary credentials, remove emergency access and verify
that monitoring/alerts are restored.
