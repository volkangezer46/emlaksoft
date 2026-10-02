# Security Policy

## Reporting a vulnerability

Do not open a public issue for suspected credential exposure, tenant data
access, authentication bypass or payment/webhook weaknesses. Report privately
to the repository security contact and include:

- affected route/module and environment;
- reproducible steps with secrets and personal data redacted;
- impact, tenant boundary and required privileges;
- logs, request IDs and timestamps in UTC;
- suggested containment, if known.

The security owner should acknowledge a critical report as soon as operationally
possible, assign an incident commander and move active exploitation into the
incident runbook. Public disclosure happens only after containment and a
coordinated fix.

## Supported code

The current production deployment and the `main` branch receive security
fixes. Historical releases are not patched in place; production is moved to a
fixed forward release or a known-good deployment.

## Security invariants

- Tenant-owned rows are isolated by database RLS and server-side authorization.
- Service-role and database credentials never enter `NEXT_PUBLIC_*` variables,
  browser bundles, tickets or logs.
- Cron routes require `Authorization: Bearer CRON_SECRET` in production.
- Webhooks verify provider signatures before processing and remain idempotent.
- Applied migrations are immutable and checksum tracked.
- Demo login and demo billing paths stay disabled in production.
- Support attachments remain private and are served through authorized routes.
- Impersonation and platform administration are attributable and auditable.

## Required release controls

CI scans full Git history for secrets and runs action, dependency, link,
migration, cron, type, lint, unit, public E2E and build gates. Production
readiness is exposed at `/api/health` with deploy SHA and migration state.
Database-backed release checks use read-only checksum validation and an RLS
audit whose transaction is rolled back.

Any dependency exception must identify exact advisories and installed versions,
an accountable owner, reason, exit condition and expiry date. Expired or stale
exceptions fail CI.

## Operational references

- Incident response: [`docs/runbooks/INCIDENT_RESPONSE.md`](docs/runbooks/INCIDENT_RESPONSE.md)
- Application/database rollback: [`docs/runbooks/ROLLBACK.md`](docs/runbooks/ROLLBACK.md)
- Backup restore: [`docs/runbooks/RESTORE.md`](docs/runbooks/RESTORE.md)
- Release gates: [`DEPLOY_CHECKLIST.md`](DEPLOY_CHECKLIST.md)

