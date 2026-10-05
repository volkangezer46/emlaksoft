/**
 * Bildirim tekrar önleme için SAF yardımcılar (DB yok, test edilebilir).
 *
 * `notifications.dedupe_key` (migration 20260826001500) varsa anahtar bazlı, yoksa eski gövde-izi (`task:<uuid>`)
 * davranışı kullanılır. Kolon henüz uygulanmamışsa kod güvenle eski yola düşer.
 */

export type DedupeError = { code?: string | null; message?: string | null } | null | undefined;

/** `<ön ek>:<parçalar...>` biçiminde deterministik anahtar (boşluk/ayraç temizlenir, 200 karakterle sınırlı). */
export function buildDedupeKey(prefix: string, ...parts: (string | number | null | undefined)[]): string {
  const clean = parts.map((p) => String(p ?? "").trim().replace(/\s+/g, "_"));
  return [prefix, ...clean].join(":").slice(0, 200);
}

/** Kova anahtarı: aralığa (ör. 24 saat) bölünmüş zaman damgası — "24 saatte en fazla 1 bildirim". */
export function timeBucket(nowMs: number, bucketMs: number): number {
  return Math.floor(nowMs / bucketMs);
}

/** dedupe_key kolonu yok (migration uygulanmamış) hatası mı? PostgREST 42703 / PGRST204 / mesaj. */
export function isMissingDedupeColumn(error: DedupeError): boolean {
  if (!error) return false;
  const msg = String(error.message ?? "").toLowerCase();
  if (!msg.includes("dedupe_key")) return false;
  return error.code === "42703" || error.code === "PGRST204" || msg.includes("column") || msg.includes("schema cache");
}

/** Benzersiz indeks ihlali (aynı anahtar zaten var) mı? */
export function isUniqueViolation(error: DedupeError): boolean {
  if (!error) return false;
  return error.code === "23505" || String(error.message ?? "").toLowerCase().includes("duplicate key");
}

/** Satırlardan dedupe_key alanını çıkarır (kolonsuz eski şemaya yazmak için). */
export function stripDedupeKey<T extends { dedupe_key?: string | null }>(rows: readonly T[]): Omit<T, "dedupe_key">[] {
  return rows.map((r) => {
    const { dedupe_key: _ignored, ...rest } = r;
    void _ignored;
    return rest;
  });
}

/** Aynı toplu insert içindeki yinelenen anahtarları ayıklar (ilk görülen kalır); anahtarsız satırlar korunur. */
export function uniqueByDedupeKey<T extends { tenant_id: string; dedupe_key?: string | null }>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    if (r.dedupe_key) {
      const k = `${r.tenant_id}|${r.dedupe_key}`;
      if (seen.has(k)) continue;
      seen.add(k);
    }
    out.push(r);
  }
  return out;
}
