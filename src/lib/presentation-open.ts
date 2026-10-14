import type { SupabaseClient } from "@supabase/supabase-js";
import { HTML_LIMITED_BOTS } from "@/lib/seo/html-limited-bots";
import { notifyTenant } from "@/lib/notify";
import { trDayKey } from "@/lib/clock";
import { presentationFeedbackHref } from "@/lib/presentation-feedback";

/**
 * Sunum açılış istihbaratı (YD2) — /sunum/[token] sayfasının `after()` gövdesi, test edilebilsin diye burada.
 *
 * NEDEN bot süzgeci: danışman linki WhatsApp/Telegram'a yapıştırınca önizleyici sayfanın HTML'ini çerezsiz çeker.
 * Süzgeç olmasa bu istek sayacı artırır ve "Sunumunuz ilk kez açıldı" bildirimi müşteri linki açmadan gider; günlük
 * dedupe_key o günün hakkını bota harcar, müşterinin gerçek açılışı aynı gün hiç bildirilmez.
 * Kural: Next'in HTML-limited bot listesi (WhatsApp, facebookexternalhit, Twitterbot, Slackbot, Discordbot…) +
 * listede olmayan önizleyiciler (TelegramBot, Viber, Skype…) + genel bot/crawler/spider imzası + boş UA + tarayıcı
 * ön-yüklemesi (prefetch). İnsan tarayıcısı eşleşmez.
 */
const EXTRA_PREVIEW_BOTS = /TelegramBot|Viber|SkypeUriPreview|Snapchat|Pinterest|Embedly|Iframely|HeadlessChrome|\bbot\b|bot\/|crawler|spider|preview|curl\/|wget\/|python-requests|okhttp|Go-http-client|node-fetch|axios\//i;

export function isLinkPreviewRequest(userAgent: string | null | undefined, purpose?: string | null): boolean {
  if (purpose && /prefetch|prerender/i.test(purpose)) return true;
  const ua = String(userAgent ?? "").trim();
  if (!ua) return true;
  return HTML_LIMITED_BOTS.test(ua) || EXTRA_PREVIEW_BOTS.test(ua);
}

export type PresentationOpenInput = {
  id: string;
  tenant_id: string;
  title: string;
  customer_name: string | null;
  customer_id: string | null;
  created_by: string | null;
  view_count: number | null;
};

/**
 * Görüntülenme +1 (atomik RPC) ve danışmana "sunumunuz açıldı" bildirimi — günde en çok bir kez (dedupe_key).
 * Önizleme botu: ne sayaç ne bildirim. Danışmanın kendi önizlemesi: sayaç artar (eski davranış), bildirim yok.
 * Bildirim hatası yutulur (ziyaretçi sayfası düşmez).
 */
export async function recordPresentationOpen(
  admin: Pick<SupabaseClient, "rpc">,
  pres: PresentationOpenInput,
  opts: { isPreviewBot: boolean; isCreatorPreview: boolean },
): Promise<void> {
  if (opts.isPreviewBot) return;
  const { error } = await admin.rpc("increment_presentation_view", { p_id: pres.id });
  if (error) console.error("increment_presentation_view", error.message);
  if (opts.isCreatorPreview || !pres.created_by) return;
  const openCount = Number(pres.view_count ?? 0) + 1;
  const label = pres.customer_name ? `${pres.customer_name} için hazırladığınız` : "Hazırladığınız";
  await notifyTenant({
    tenantId: pres.tenant_id,
    userId: pres.created_by,
    title: openCount <= 1 ? "Sunumunuz ilk kez açıldı" : "Sunumunuz yeniden açıldı",
    body: `${label} "${pres.title}" sunumu görüntülendi (toplam ${openCount} açılış).`,
    href: presentationFeedbackHref(pres.customer_id),
    kind: "info",
    prefKey: "share",
    dedupeKey: `presentation-open:${pres.id}:${trDayKey()}`,
  }).catch((e) => console.error("presentation open notify", e instanceof Error ? e.message : e));
}
