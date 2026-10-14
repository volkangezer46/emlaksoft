/**
 * Zamanlanmış rapor teslimi — üretim bağımlılıkları (SUNUCU, yalnız cron). Saf akış `delivery.ts`'tedir (testte
 * bağımlılıklar sahtelenir); burası gerçek e-posta (AD7 `sendLoggedEmail`), dosya üretimi, denetim ve auth e-posta
 * çözümünü bağlar. `db`: çağıran cron'un servis istemcisi (bu modül istemci oluşturmaz).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { logActivity } from "@/lib/activity";
import { getBaseUrl } from "@/lib/base-url";
import { emailChannelStatus, EMAIL_ATTACHMENT_MAX_BYTES } from "@/lib/email/provider";
import { sendLoggedEmail } from "@/lib/email/send";
import type { FeatureKey } from "@/lib/modules/registry";
import { logPlatformActivity } from "@/lib/platform-activity";
import { buildPlatformContext } from "./context";
import { runReportSubscriptionDelivery, SUBSCRIPTION_SEND_ACTION, type DeliverySummary } from "./delivery";
import { renderReport } from "./render";

export async function deliverDueReportSubscriptions(
  db: SupabaseClient,
  nowMs: number,
  opts: { disabledModules?: Map<string, Set<FeatureKey>>; shouldStop?: () => boolean } = {},
): Promise<DeliverySummary> {
  const appUrl = getBaseUrl();
  return runReportSubscriptionDelivery(db, {
    nowMs,
    send: (input) => sendLoggedEmail(input),
    render: (o) => renderReport(o),
    channel: async () => {
      const s = await emailChannelStatus();
      return { enabled: s.enabled, reason: s.reason };
    },
    userEmail: async (userId) => {
      try {
        const { data } = await db.auth.admin.getUserById(userId);
        return data.user?.email ?? null;
      } catch {
        return null;
      }
    },
    platformContext: (staff) => buildPlatformContext(staff),
    audit: async ({ scope, tenantId, actorId, def, subscriptionId, value }) => {
      if (scope === "tenant" && tenantId) {
        await logActivity({ tenantId, actorId, action: SUBSCRIPTION_SEND_ACTION, entityType: def.id, entityId: subscriptionId, newValue: value });
      } else {
        await logPlatformActivity({ actorId, action: SUBSCRIPTION_SEND_ACTION, entityType: def.id, entityId: subscriptionId, meta: value });
      }
    },
    attachmentMaxBytes: EMAIL_ATTACHMENT_MAX_BYTES,
    appUrl,
    disabledModules: opts.disabledModules,
    shouldStop: opts.shouldStop,
  });
}
