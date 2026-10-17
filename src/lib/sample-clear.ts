import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * "Gerçek kullanıma başla" temizliği — TEK merkez (sunucu; istemci import ETMEZ).
 *
 * Kurallar:
 *  - YALNIZ `is_sample = true` ve ilgili `tenant_id` satırları silinir; ofisin gerçek (is_sample=false)
 *    kayıtlarına dokunulmaz.
 *  - Sıra bağımlılığa uygundur: çocuk tablolar (komisyon, anlaşma, teklif, kira...) ana tablolardan
 *    (portföy, müşteri) ÖNCE silinir.
 *  - `is_sample` sütunu olmayan tablo (genişletme migration'ı uygulanmamış) hata değil "etkin değil" sayılır.
 *  - Bir tablo hata verirse (ör. demo kayda bağlanmış gerçek bir kayıt, FK) diğer tablolar yine denenir;
 *    sonuçta `partial` raporlanır ve işlem tekrar denenebilir (idempotent: silinecek kalmayınca 0 döner).
 *  - Kazanılmış anlaşma/komisyon/kira çekirdek iş akışı tetikleyicileriyle korunur; bu yüzden silme
 *    service_role client'ıyla (çağıran `tenantId`'yi kapıdan çıkarmış olmalı) yapılır.
 */

export type SampleTableSpec = { table: string; label: string };

/**
 * Silme sırası: bağımlı → ana (RPC yokken yedek yol). `profiles` BİLEREK yok: demo ekip yalnız RPC v2'de (is_sample profil,
 * bağlantı kalmadıysa) kaldırılır; bu yol gerçek kullanıcıya hiçbir koşulda dokunmaz.
 */
export const SAMPLE_CLEAR_ORDER: readonly SampleTableSpec[] = [
  // Kayıt modülleri (çocuk → ebeveyn): tutanak kiradan, başvuru bağlantıdan, evrak dosyası talepten önce.
  { table: "rental_inspections", label: "Teslim/tahliye tutanağı" },
  { table: "rental_applications", label: "Kiracı başvurusu" },
  { table: "rental_application_links", label: "Kiracı başvuru bağlantısı" },
  { table: "document_request_files", label: "Evrak dosyası" },
  { table: "document_requests", label: "Evrak talebi" },
  { table: "finance_budgets", label: "Bütçe satırı" },
  { table: "commissions", label: "Komisyon / hakediş" },
  { table: "deals", label: "Anlaşma" },
  { table: "offers", label: "Teklif" },
  { table: "rentals", label: "Kira sözleşmesi" },
  { table: "expenses", label: "Gider" },
  { table: "calls", label: "Arama kaydı" },
  { table: "notifications", label: "Bildirim" },
  { table: "campaigns", label: "Kampanya" },
  { table: "communications", label: "Mesaj" },
  { table: "tasks", label: "Görev" },
  { table: "appointments", label: "Randevu" },
  { table: "customer_demands", label: "Talep" },
  { table: "properties", label: "Portföy" },
  { table: "customers", label: "Müşteri" },
];

export type SampleCountRow = { table: string; label: string; count: number | null };
export type SampleCountSummary = { rows: SampleCountRow[]; total: number };

type DbError = { code?: string; message?: string } | null | undefined;

/** Sütun/tablo yok türü hata mı? (uygulanmamış genişletme: "etkin değil", hata değil.) */
export function isMissingSampleSchema(error: DbError): boolean {
  if (!error) return false;
  const msg = String(error.message ?? "").toLowerCase();
  const code = String(error.code ?? "");
  return code === "42703" || code === "42P01" || code === "PGRST204" || code === "PGRST205" || msg.includes("is_sample") || msg.includes("does not exist");
}

/**
 * Yalnız SAYILAN (bu tablo-tablo yolda silinmeyen) örnek varlıklar: demo ekip üyeleri RPC'de pasifleştirilip kaldırılır,
 * kimlikleri uygulamada silinir (personas.ts). Onay ekranında "neyin silineceği" eksiksiz görünsün diye listelenir.
 */
export const SAMPLE_COUNT_ONLY: readonly SampleTableSpec[] = [{ table: "profiles", label: "Demo ekip üyesi" }];

/** Silinecek örnek kayıt sayıları (salt okunur). Sütunu olmayan tablo `count: null`. */
export async function countSampleRecords(db: SupabaseClient, tenantId: string): Promise<SampleCountSummary> {
  const photos = (async (): Promise<SampleCountRow> => {
    // Örnek portföy fotoğrafları (statik kütüphane satırları): portföyle birlikte silinir; dosyalar statiktir, silinmez.
    const { count, error } = await db
      .from("property_media")
      .select("id, property:properties!property_media_property_id_fkey!inner(is_sample)", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("property.is_sample", true);
    return { table: "property_media", label: "Portföy fotoğrafı", count: error ? null : (count ?? 0) };
  })();
  const rows = await Promise.all(
    [...SAMPLE_CLEAR_ORDER, ...SAMPLE_COUNT_ONLY].map(async ({ table, label }): Promise<SampleCountRow> => {
      const base = db.from(table).select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("is_sample", true);
      // Demo ekip: yalnız etkin profiller (gerçek kayda bağlı kaldığı için pasif bırakılan profil "silinecek" sayılmaz).
      const { count, error } = await (table === "profiles" ? base.eq("is_active", true) : base);
      if (error) return { table, label, count: null };
      return { table, label, count: count ?? 0 };
    }),
  );
  rows.push(await photos);
  const total = rows.reduce((s, r) => s + (r.count ?? 0), 0);
  return { rows, total };
}

export type SampleClearReport = {
  /** Tablo başına silinen satır sayısı. */
  deleted: Record<string, number>;
  /** Şemada olmayan/etkin olmayan tablolar. */
  unavailable: string[];
  /** Hata veren tablolar (yarım kaldı → tekrar denenebilir). */
  failed: { table: string; label: string; message: string }[];
  totalDeleted: number;
  /** Hiç hata yok: tümü temizlendi. */
  complete: boolean;
};

/** Tüm örnek kayıtları bağımlılık sırasıyla siler; kısmi hatayı raporlar. */
export async function deleteSampleRecords(db: SupabaseClient, tenantId: string): Promise<SampleClearReport> {
  const report: SampleClearReport = { deleted: {}, unavailable: [], failed: [], totalDeleted: 0, complete: true };
  for (const { table, label } of SAMPLE_CLEAR_ORDER) {
    const { count, error } = await db
      .from(table)
      .delete({ count: "exact" })
      .eq("tenant_id", tenantId)
      .eq("is_sample", true);
    if (error) {
      if (isMissingSampleSchema(error)) {
        report.unavailable.push(table);
        continue;
      }
      console.error(`deleteSampleRecords:${table}`, error);
      report.failed.push({
        table,
        label,
        message:
          error.code === "23503"
            ? "Örnek kayda bağlı gerçek bir kayıt var; önce o bağlantıyı kaldırın."
            : "Silinemedi.",
      });
      continue;
    }
    const n = count ?? 0;
    report.deleted[table] = n;
    report.totalDeleted += n;
  }
  report.complete = report.failed.length === 0;
  return report;
}

/** Türkçe özet satırı: "12 müşteri, 9 portföy ..." (sıfırlar atlanır). */
export function describeSampleCounts(summary: SampleCountSummary): string {
  const parts = summary.rows.filter((r) => (r.count ?? 0) > 0).map((r) => `${r.count} ${r.label.toLocaleLowerCase("tr-TR")}`);
  return parts.length ? parts.join(", ") : "silinecek örnek kayıt yok";
}
