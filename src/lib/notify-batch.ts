import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Cron bildirimleri için toplu (batch) yardımcılar — N+1 sorgu önleyici.
 *
 * SORUN: Hatırlatma cron'ları şu deseni kullanıyordu:
 *
 *   for (const task of tasks) {            // 300 kayıt
 *     const existing = await select(...)   // 1 SORGU  → 300
 *     await insert(...)                    // 1 SORGU  → 300
 *   }                                      // toplam 600 gidiş-dönüş
 *
 * Her gidiş-dönüş pooler üzerinden ~5-20 ms; 600 tanesi cron'u 3-12 saniyeye
 * çıkarıyor ve Vercel fonksiyon süresini tüketiyor. Kayıt sayısı arttıkça
 * doğrusal kötüleşiyor.
 *
 * ÇÖZÜM: 2 sorgu. Pencereye giren bildirimleri bir kez çek, marker'ları
 * bellekte eşle, yeni olanları tek insert ile yaz.
 *
 * Marker deseni: bildirim gövdesine `task:<uuid>` gibi bir iz bırakılıyor ve
 * tekrar bildirimi engellemek için bu iz aranıyor. Mevcut davranış korundu —
 * yalnızca sorgu sayısı değişti.
 */

export type NotificationRow = {
  tenant_id: string;
  user_id?: string | null;
  title: string;
  body: string;
  href: string;
  kind?: string;
};

/**
 * Verilen pencerede zaten bildirilmiş kayıtların id'lerini tek sorguda döndürür.
 *
 * `limit` bilinçli olarak yüksek: pencereye sığmayan bildirim kalırsa aynı
 * kayda ikinci bildirim gidebilir. Bu, bildirim kaçırmaktan iyidir (sessiz
 * kayıp yerine görünür tekrar) ama sınırı aşarsa uyarı loglanır.
 */
export async function findNotifiedIds(
  admin: SupabaseClient,
  opts: {
    href: string;
    tenantIds: string[];
    sinceIso: string;
    /** Gövdedeki iz öneki, ör. "task" → `task:<uuid>` aranır */
    markerPrefix: string;
    limit?: number;
  },
): Promise<Set<string>> {
  const found = new Set<string>();
  if (opts.tenantIds.length === 0) return found;

  const limit = opts.limit ?? 5000;
  const { data, error } = await admin
    .from("notifications")
    .select("body")
    .in("tenant_id", opts.tenantIds)
    .eq("href", opts.href)
    .gte("created_at", opts.sinceIso)
    .limit(limit);

  if (error) {
    // Hata durumunda BOŞ küme dönmek "hiçbiri bildirilmemiş" demek olur ve
    // tekrar bildirim üretir. Sessizce yutmak yerine logla; tekrar bildirim
    // bildirim kaçırmaktan yine de iyidir.
    console.error("findNotifiedIds", error.message);
    return found;
  }

  if (data && data.length >= limit) {
    console.warn(
      `findNotifiedIds: ${opts.href} için pencere limiti (${limit}) doldu — mükerrer bildirim olabilir`,
    );
  }

  const re = new RegExp(`${opts.markerPrefix}:([0-9a-f-]{36})`, "i");
  for (const row of data ?? []) {
    const m = re.exec(String(row.body ?? ""));
    if (m) found.add(m[1].toLowerCase());
  }
  return found;
}

/** Toplu insert. Liste boşsa hiç sorgu atmaz. Yazılan satır sayısını döndürür. */
export async function insertNotifications(
  admin: SupabaseClient,
  rows: NotificationRow[],
): Promise<number> {
  if (rows.length === 0) return 0;

  // Çok büyük listeler tek istekte gönderilmesin (payload sınırı)
  const CHUNK = 500;
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await admin.from("notifications").insert(chunk);
    if (error) {
      console.error("insertNotifications", error.message);
      continue;
    }
    written += chunk.length;
  }
  return written;
}
