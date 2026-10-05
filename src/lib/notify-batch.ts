import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingDedupeColumn, isUniqueViolation, stripDedupeKey, uniqueByDedupeKey } from "@/lib/notify-dedupe";

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
  /**
   * Anahtar bazlı tekrar önleme (notifications.dedupe_key, kısmi benzersiz indeks). Kolon henüz yoksa insert
   * anahtarsız yeniden denenir (eski gövde-izi davranışı).
   */
  dedupe_key?: string | null;
};

export type InsertResult = {
  /** Gerçekten yazılan satır. */
  written: number;
  /** Aynı dedupe_key zaten vardı (hata değil; atlandı). */
  duplicates: number;
  /** Yazılamayan satır (gerçek hata). */
  failed: number;
};

const FIND_PAGE = 1000;
const FIND_MAX_PAGES = 20;

/**
 * Verilen dedupe anahtarlarından zaten yazılmış olanları döndürür. Kolon yoksa veya sorgu hata verirse `null`
 * (çağıran eski gövde-izi yoluna düşer / anahtarsız devam eder; mükerrer koruması insert tarafındaki indekste kalır).
 */
export async function findNotifiedKeys(
  admin: SupabaseClient,
  opts: { tenantIds: string[]; keys: string[] },
): Promise<Set<string> | null> {
  const found = new Set<string>();
  if (opts.keys.length === 0 || opts.tenantIds.length === 0) return found;
  const unique = [...new Set(opts.keys)];
  for (let i = 0; i < unique.length; i += 200) {
    const part = unique.slice(i, i + 200);
    const { data, error } = await admin
      .from("notifications")
      .select("dedupe_key")
      .in("tenant_id", opts.tenantIds)
      .in("dedupe_key", part)
      .limit(FIND_PAGE);
    if (error) {
      if (!isMissingDedupeColumn(error)) console.error("findNotifiedKeys", error.message);
      return null;
    }
    for (const r of (data ?? []) as { dedupe_key: string | null }[]) {
      if (r.dedupe_key) found.add(r.dedupe_key);
    }
  }
  return found;
}

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

  // Sayfalı okuma (eski tek-sorgu 5000 satır tavanı kaldırıldı): sıralı sayfalar, `limit` toplam üst sınırdır.
  const limit = opts.limit ?? FIND_PAGE * FIND_MAX_PAGES;
  const re = new RegExp(`${opts.markerPrefix}:([0-9a-f-]{36})`, "i");
  let read = 0;
  for (let from = 0; from < limit; from += FIND_PAGE) {
    const { data, error } = await admin
      .from("notifications")
      .select("body")
      .in("tenant_id", opts.tenantIds)
      .eq("href", opts.href)
      .gte("created_at", opts.sinceIso)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + FIND_PAGE - 1);

    if (error) {
      // Hata durumunda eldeki küme dönmek tekrar bildirim üretebilir; bildirim kaçırmaktan iyidir ama logla.
      console.error("findNotifiedIds", error.message);
      return found;
    }
    const rows = data ?? [];
    read += rows.length;
    for (const row of rows) {
      const m = re.exec(String(row.body ?? ""));
      if (m) found.add(m[1].toLowerCase());
    }
    if (rows.length < FIND_PAGE) return found;
  }

  console.warn(`findNotifiedIds: ${opts.href} için pencere limiti (${read}) doldu — mükerrer bildirim olabilir`);
  return found;
}

/**
 * Son `sinceIso`'den beri yazılmış, `prefix` ile başlayan dedupe anahtarları (ör. "portal-teyit:" → ilan başına
 * 24 saatte 1 bildirim). Kolon yoksa veya sorgu hata verirse `null` (çağıran eski davranışa düşer).
 */
export async function findRecentKeysByPrefix(
  admin: SupabaseClient,
  opts: { tenantIds: string[]; prefix: string; sinceIso: string },
): Promise<Set<string> | null> {
  const found = new Set<string>();
  if (opts.tenantIds.length === 0) return found;
  for (let from = 0; from < FIND_PAGE * FIND_MAX_PAGES; from += FIND_PAGE) {
    const { data, error } = await admin
      .from("notifications")
      .select("dedupe_key")
      .in("tenant_id", opts.tenantIds)
      .like("dedupe_key", `${opts.prefix}%`)
      .gte("created_at", opts.sinceIso)
      .order("id", { ascending: true })
      .range(from, from + FIND_PAGE - 1);
    if (error) {
      if (!isMissingDedupeColumn(error)) console.error("findRecentKeysByPrefix", error.message);
      return null;
    }
    const rows = (data ?? []) as { dedupe_key: string | null }[];
    for (const r of rows) if (r.dedupe_key) found.add(r.dedupe_key);
    if (rows.length < FIND_PAGE) return found;
  }
  return found;
}

async function insertChunk(admin: SupabaseClient, chunk: NotificationRow[]): Promise<InsertResult> {
  const result: InsertResult = { written: 0, duplicates: 0, failed: 0 };
  let rows: NotificationRow[] = uniqueByDedupeKey(chunk);
  result.duplicates += chunk.length - rows.length;

  let { error } = await admin.from("notifications").insert(rows);
  if (error && isMissingDedupeColumn(error)) {
    // Migration henüz uygulanmamış: anahtarsız eski davranış.
    rows = stripDedupeKey(rows) as NotificationRow[];
    ({ error } = await admin.from("notifications").insert(rows));
  }
  if (!error) {
    result.written += rows.length;
    return result;
  }
  if (isUniqueViolation(error)) {
    // Partideki bir anahtar zaten var: satır satır dene, yinelenenleri say, gerisini yaz.
    for (const row of rows) {
      const { error: rowError } = await admin.from("notifications").insert(row);
      if (!rowError) result.written += 1;
      else if (isUniqueViolation(rowError)) result.duplicates += 1;
      else {
        console.error("insertNotifications", rowError.message);
        result.failed += 1;
      }
    }
    return result;
  }
  console.error("insertNotifications", error.message);
  result.failed += rows.length;
  return result;
}

/** Toplu insert (ayrıntılı sonuç). Liste boşsa hiç sorgu atmaz. */
export async function insertNotificationsDetailed(
  admin: SupabaseClient,
  rows: NotificationRow[],
): Promise<InsertResult> {
  const total: InsertResult = { written: 0, duplicates: 0, failed: 0 };
  if (rows.length === 0) return total;

  // Çok büyük listeler tek istekte gönderilmesin (payload sınırı)
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = await insertChunk(admin, rows.slice(i, i + CHUNK));
    total.written += part.written;
    total.duplicates += part.duplicates;
    total.failed += part.failed;
  }
  return total;
}

/** Toplu insert. Liste boşsa hiç sorgu atmaz. Yazılan satır sayısını döndürür. */
export async function insertNotifications(
  admin: SupabaseClient,
  rows: NotificationRow[],
): Promise<number> {
  return (await insertNotificationsDetailed(admin, rows)).written;
}
