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

/** Silme sırası: bağımlı → ana. `profiles` BİLEREK yok (demo hesap açılmaz, gerçek kullanıcıya dokunulmaz). */
export const SAMPLE_CLEAR_ORDER: readonly SampleTableSpec[] = [
  { table: "commissions", label: "Komisyon / hakediş" },
  { table: "deals", label: "Anlaşma" },
  { table: "offers", label: "Teklif" },
  { table: "rentals", label: "Kira sözleşmesi" },
  { table: "expenses", label: "Gider" },
  { table: "calls", label: "Arama kaydı" },
  { table: "notifications", label: "Bildirim" },
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

/** Silinecek örnek kayıt sayıları (salt okunur). Sütunu olmayan tablo `count: null`. */
export async function countSampleRecords(db: SupabaseClient, tenantId: string): Promise<SampleCountSummary> {
  const rows = await Promise.all(
    SAMPLE_CLEAR_ORDER.map(async ({ table, label }): Promise<SampleCountRow> => {
      const { count, error } = await db
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("is_sample", true);
      if (error) return { table, label, count: null };
      return { table, label, count: count ?? 0 };
    }),
  );
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
