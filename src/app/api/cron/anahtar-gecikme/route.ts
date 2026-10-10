import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findNotifiedIds, insertNotificationsDetailed, type NotificationRow } from "@/lib/notify-batch";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { heartbeatFor, failureNote } from "@/lib/cron-heartbeat-status";
import { readAllPaged } from "@/lib/supabase/read-all-paged";
import { keyOverdueDays } from "@/lib/key-overdue";
import { getDisabledModulesByTenant, isDisabledFor, skippedTenantsNote } from "@/lib/modules/state";
import { authorizeCron } from "@/lib/cron-auth";

/** Toplu/uzun işlem: varsayılan süre yetmeyebilir. */
export const maxDuration = 300;

/** Bildirimin sabit hedefi — mükerrer freni bu href üzerinden sorgulanır. */
const HREF = "/app/portfoyler/anahtarlar?durum=gecikmis";

type OverdueKey = {
  id: string;
  tenant_id: string;
  property_id: string;
  label: string;
  status: string;
  holder_staff_id: string | null;
  holder_name: string | null;
  due_at: string | null;
  returned_at: string | null;
  property: { property_code: string; title: string | null; assigned_to: string | null } | null;
  holder: { full_name: string | null } | null;
};

/**
 * Anahtar iade gecikmesi cron'u (günlük 09:00 — vercel.json).
 *
 * Vadesi geçmiş ve hâlâ dışarıda olan anahtarlar için iki kişiye bildirim
 * yazar: anahtarı alan danışman (holder_staff_id) ve portföyün sorumlusu
 * (properties.assigned_to). Anahtar müşterideyse yalnız portföy sorumlusu
 * uyarılır — bilgi kimseye kaybolmaz.
 *
 * MÜKERRER FRENİ — SEÇİM: `?anahtar={id}` query marker'ı YERİNE **20 saatlik
 * pencere + gövde marker'ı** (`anahtar:<key_id>`) tercih edildi, çünkü:
 *  - href'e işlevsel olmayan bir query parametresi eklemek link kontratını
 *    (`npm run check:links`) bozar; kira/haftalık özet cron'ları bunu ancak
 *    ALLOWLIST istisnasıyla yapabiliyor.
 *  - Gövde marker'ı zaten projedeki standart (gorev-hatirlat, proje-vade) ve
 *    `findNotifiedIds` ile 2 sorguda çözülüyor.
 * Sonuç: aynı anahtar için günde en fazla 1 bildirim.
 *
 * Gecikme tanımı tek kaynaktan: src/lib/key-overdue.ts (`keyOverdueDays`) —
 * pano ve portföy detayı da aynı fonksiyonu kullanır.
 */
export async function GET(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;

  try {
    const admin = createAdminClient();
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    const keysRes = await readAllPaged<OverdueKey>(
      (from, to) =>
        admin
          .from("property_keys")
          .select(
            "id, tenant_id, property_id, label, status, holder_staff_id, holder_name, due_at, returned_at, property:properties!property_keys_property_id_fkey(property_code, title, assigned_to), holder:profiles!property_keys_holder_staff_id_fkey(full_name)",
          )
          .in("status", ["danisanda", "musteride"])
          .is("returned_at", null)
          .not("due_at", "is", null)
          .lt("due_at", nowIso)
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{ data: OverdueKey[] | null; error: { message: string } | null }>,
    );
    const data = keysRes.rows;
    const error = keysRes.error;
    const truncated = keysRes.truncated;

    if (error) {
      console.error("cron anahtar-gecikme query", error);
      await recordHeartbeat("anahtar-gecikme", "error", "gecikme sorgusu başarısız");
      return NextResponse.json({ error: "query_failed" }, { status: 500 });
    }

    // Modül kapısı: "Anahtar Takibi" kapalı ofislere uyarı yazılmaz (kayıtlar silinmez).
    const disabledModules = await getDisabledModulesByTenant(admin);
    const rows = data.filter((r) => !isDisabledFor(disabledModules, r.tenant_id, "keys"));
    if (rows.length === 0) {
      await recordHeartbeat("anahtar-gecikme", heartbeatFor({ truncated }), "geciken anahtar yok" + skippedTenantsNote(disabledModules, "keys") + failureNote({ truncated }));
      return NextResponse.json({ ok: true, overdue: 0, notified: 0 });
    }

    const tenantIds = [...new Set(rows.map((r) => r.tenant_id))];
    const windowStart = new Date(nowMs - 20 * 3600_000).toISOString();
    const alreadyNotified = await findNotifiedIds(admin, {
      href: HREF,
      tenantIds,
      sinceIso: windowStart,
      markerPrefix: "anahtar",
    });

    const toInsert: NotificationRow[] = [];
    let overdue = 0;

    for (const row of rows) {
      const days = keyOverdueDays(row, nowMs);
      if (days <= 0) continue; // savunma — sorgu zaten süzdü
      overdue++;
      if (alreadyNotified.has(row.id.toLowerCase())) continue;

      const propertyLabel = row.property?.title || row.property?.property_code || "Portföy";
      const person = row.holder?.full_name || row.holder_name || "bilinmiyor";
      const body = `🔑 Anahtar iadesi gecikti: ${propertyLabel} — ${person}, ${days} gün · anahtar:${row.id}`;

      // Danışman + portföy sorumlusu (aynı kişiyse tek bildirim)
      const targets = new Set<string>();
      if (row.holder_staff_id) targets.add(row.holder_staff_id);
      if (row.property?.assigned_to) targets.add(row.property.assigned_to);

      if (targets.size === 0) {
        // Kimse atanmamışsa tenant geneline yaz — uyarı sessizce kaybolmasın
        toInsert.push({
          tenant_id: row.tenant_id,
          title: `Anahtar iadesi gecikti: ${row.label}`,
          body,
          href: HREF,
          kind: "warning",
        });
        continue;
      }

      for (const userId of targets) {
        toInsert.push({
          tenant_id: row.tenant_id,
          user_id: userId,
          title: `Anahtar iadesi gecikti: ${row.label}`,
          body,
          href: HREF,
          kind: "warning",
        });
      }
    }

    const ins = await insertNotificationsDetailed(admin, toInsert);
    const notified = ins.written;
    const failed = ins.failed;

    await recordHeartbeat(
      "anahtar-gecikme",
      heartbeatFor({ failed, truncated }),
      `${overdue} geciken anahtar, ${notified} bildirim${skippedTenantsNote(disabledModules, "keys")}${failureNote({ failed, truncated })}`,
    );
    return NextResponse.json({ ok: true, overdue, notified });
  } catch (e) {
    console.error("cron anahtar-gecikme", e);
    await recordHeartbeat("anahtar-gecikme", "error", e instanceof Error ? e.message : "bilinmeyen hata");
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
