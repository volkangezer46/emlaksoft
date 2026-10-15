import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyTenant } from "@/lib/notify";
import { trDayKey } from "@/lib/clock";
import { presentationFeedbackHref } from "@/lib/presentation-feedback";

/**
 * Sunum açılış istihbaratı (YD2) — /sunum/[token] sayfasının `after()` gövdesi, test edilebilsin diye burada.
 *
 * NEDEN bot süzgeci: danışman linki WhatsApp/Telegram'a yapıştırınca önizleyici sayfanın HTML'ini çerezsiz çeker.
 * Süzgeç olmasa bu istek sayacı artırır ve "Sunumunuz ilk kez açıldı" bildirimi müşteri linki açmadan gider; günlük
 * dedupe_key o günün hakkını bota harcar, müşterinin gerçek açılışı aynı gün hiç bildirilmez. Önizleme ayrımı TEK
 * kaynaktan gelir: `@/lib/link-preview` (isLinkPreviewRequest / isLinkPreviewHeaders).
 */
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

export type ShareOpenInput = {
  token: string;
  tenant_id: string;
  entity_id: string;
  /** Linki oluşturan AKTİF danışman (pasif/silinmiş profile bildirim gitmez); yoksa null. */
  notifyUserId: string | null;
  label: string;
};

/**
 * Paylaşım linki (/paylas/[token]) açılışı — sayfanın `after()` gövdesi (SK8 B150):
 *  - Önizleme botu / ön-yükleme: ne sayaç ne bildirim (link-preview kapısı).
 *  - Sayaç atomik RPC ile artar (`increment_share_view`, yeni değeri döndürür); render yolunu beklemez.
 *  - "Paylaştığınız portföy linki açıldı" bildirimi YALNIZ dönen değer 1 iken gider: eşzamanlı iki açılışta tek bildirim.
 * RPC/bildirim hatası yutulur (ziyaretçi sayfası düşmez).
 */
export async function recordShareOpen(
  admin: Pick<SupabaseClient, "rpc">,
  share: ShareOpenInput,
  opts: { isPreviewBot: boolean },
): Promise<void> {
  if (opts.isPreviewBot) return;
  const { data, error } = await admin.rpc("increment_share_view", { p_token: share.token });
  if (error) {
    console.error("increment_share_view", error.message);
    return;
  }
  if (Number(data) !== 1 || !share.notifyUserId) return;
  await notifyTenant({
    tenantId: share.tenant_id,
    userId: share.notifyUserId,
    title: "Paylaştığınız portföy linki açıldı",
    body: `"${share.label}" paylaşım linki ilk kez görüntülendi.`,
    href: `/app/portfoyler/${share.entity_id}`,
    kind: "info",
    prefKey: "share",
  }).catch((e) => console.error("share first-view notify", e instanceof Error ? e.message : e));
}
