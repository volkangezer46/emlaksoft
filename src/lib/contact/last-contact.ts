import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * "Son temas" TEK TANIMI: müşteriyle iletişim kaydı (communications), telefon görüşmesi (calls)
 * ve gerçekleşmiş/planlı-geçmiş randevu (iptal edilmemiş, şimdiye kadar). Eskiden otomasyon
 * (no_contact_days) yalnız communications'a bakıyordu; arama ya da randevusu olan müşteriye de
 * "uzun süredir görüşmediniz" mesajı gidebiliyordu.
 *
 * Neden `customer_heat_signals` RPC'si DEĞİL: RPC `assert_current_tenant()` ile oturumdaki
 * kullanıcının kiracısını doğrular (20260731000133 satır 248-341); service_role'ün oturum kullanıcısı
 * yoktur, bu yüzden çağrı "Tenant scope mismatch" (42501) ile düşer. Otomasyon cron'u service_role
 * ile çalıştığından aynı tanım doğrudan, kiracı süzgeçli ve parçalı sorgularla okunur
 * (RPC'nin last_contact = max(communications, appointments, calls) tanımının birebir karşılığı;
 * tek fark: iptal edilmiş ve gelecekteki randevu temas sayılmaz).
 */

/** Cron 60 sn bütçesi için bir sorguya girecek en çok müşteri kimliği. */
export const LAST_CONTACT_CHUNK = 50;
/** Bir sorgunun döndürebileceği satır tavanı; dolarsa parça ikiye bölünür (kesik veriyle karar verilmez). */
export const LAST_CONTACT_ROW_CAP = 1000;

/**
 * SAF eşik karşılaştırması: son temas yoksa ya da eşikten eskiyse "temas yok" sayılır.
 * `cutoffIso` = şimdi - gün. Eşiğe eşit an temas SAYILIR (pencere içinde).
 */
export function isContactStale(lastContactIso: string | null | undefined, cutoffIso: string): boolean {
  if (!lastContactIso) return true;
  const last = Date.parse(lastContactIso);
  const cutoff = Date.parse(cutoffIso);
  if (!Number.isFinite(last) || !Number.isFinite(cutoff)) return true;
  return last < cutoff;
}

/** SAF: iki zaman damgasından yenisi (null güvenli). */
export function laterOf(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

type SourceDef = {
  table: "communications" | "calls" | "appointments";
  ts: "created_at" | "started_at" | "scheduled_at";
  /** İptal edilmiş kayıt temas sayılmaz (randevu). */
  excludeCancelled?: boolean;
};

const SOURCES: readonly SourceDef[] = [
  { table: "communications", ts: "created_at" },
  { table: "calls", ts: "started_at" },
  { table: "appointments", ts: "scheduled_at", excludeCancelled: true },
];

type Row = { customer_id: string | null; ts: string | null };

async function readSource(
  client: SupabaseClient,
  src: SourceDef,
  tenantId: string,
  ids: readonly string[],
  sinceIso: string,
  untilIso: string,
): Promise<Row[]> {
  let q = client
    .from(src.table)
    .select(`customer_id, ts:${src.ts}`)
    .eq("tenant_id", tenantId)
    .in("customer_id", ids as string[])
    .gte(src.ts, sinceIso)
    .lte(src.ts, untilIso);
  if (src.excludeCancelled) q = q.neq("status", "cancelled");
  const { data, error } = await q.order(src.ts, { ascending: false }).limit(ids.length === 1 ? 1 : LAST_CONTACT_ROW_CAP);
  if (error) throw new Error(`last_contact ${src.table}: ${error.message}`);
  return (data ?? []) as unknown as Row[];
}

async function readChunk(
  client: SupabaseClient,
  tenantId: string,
  ids: readonly string[],
  sinceIso: string,
  untilIso: string,
  out: Map<string, string>,
): Promise<void> {
  const results = await Promise.all(SOURCES.map((s) => readSource(client, s, tenantId, ids, sinceIso, untilIso)));
  // Tek kimlikte limit(1) yeterlidir (en yeni satır); çoklu kimlikte tavan dolduysa veri kesik olabilir → böl.
  if (ids.length > 1 && results.some((r) => r.length >= LAST_CONTACT_ROW_CAP)) {
    const mid = Math.ceil(ids.length / 2);
    await readChunk(client, tenantId, ids.slice(0, mid), sinceIso, untilIso, out);
    await readChunk(client, tenantId, ids.slice(mid), sinceIso, untilIso, out);
    return;
  }
  for (const rows of results) {
    for (const r of rows) {
      if (!r.customer_id || !r.ts) continue;
      const key = String(r.customer_id).toLowerCase();
      out.set(key, laterOf(out.get(key), r.ts) as string);
    }
  }
}

/**
 * Verilen müşteri kimlikleri için [sinceIso, untilIso] penceresindeki EN SON temas.
 * Pencerede teması olmayan müşteri haritada YOKTUR (yani `isContactStale(undefined, since)` = true).
 * Kiracı süzgeci her sorguda vardır; kimlikler parça parça okunur. Hata fırlatır: çağıran
 * "bu tetiği atla ve logla" kararını verir (yanlış mesaj gitmesin).
 */
export async function loadLastContactSince(
  client: SupabaseClient,
  tenantId: string,
  customerIds: readonly string[],
  sinceIso: string,
  untilIso: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(customerIds.map((i) => String(i)).filter(Boolean))];
  for (let i = 0; i < ids.length; i += LAST_CONTACT_CHUNK) {
    await readChunk(client, tenantId, ids.slice(i, i + LAST_CONTACT_CHUNK), sinceIso, untilIso, out);
  }
  return out;
}
