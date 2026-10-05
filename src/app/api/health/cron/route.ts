import { GET as healthGet } from "../route";

export const dynamic = "force-dynamic";

/**
 * Bayat cron yoklaması (dış uptime monitörü için). Mantık `../route.ts` içinde:
 * service_role kullanımı tek yerde kalır. Yol `/health/cron` ile biter → cron kipi.
 * HEALTHCHECK_SECRET Bearer zorunlu; bayat/hatalı iş varsa 503 + liste.
 */
export const GET = healthGet;
