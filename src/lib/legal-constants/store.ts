import "server-only";
import { unstable_cache } from "next/cache";
import { trDayKey } from "@/lib/clock";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAllLegalValues, type LegalConstantRecord } from "./history";
import type { LegalKey } from "./index";

/**
 * Mevzuat sabiti geçmişi deposu (yalnız sunucu, service_role; `legal_constants`, migration 20261013005100).
 * Kapı çağıranda (admin: guardPlatformAction("sistem")). Tablo yokken "missing": ekran kurulum bekliyor der, değerler
 * koddaki sabittir. Önbellek etiketi `legal-constants` (300 sn); yazımlar etiketi tazeler.
 */
export const LEGAL_CONSTANTS_TAG = "legal-constants";

/** Tek service_role giriş noktası (kabul listesi: src/lib/admin-client-allowlist.ts). */
function db() {
  return createAdminClient();
}

type Raw = { key: string; value: number | string; valid_from: string; note: string | null; source: string | null; created_at: string };

const toRecord = (r: Raw): LegalConstantRecord => ({
  key: r.key,
  value: Number(r.value),
  validFrom: String(r.valid_from).slice(0, 10),
  note: r.note,
  source: r.source,
  createdAt: r.created_at,
});

export type LegalConstantHistory = { status: "ok"; records: LegalConstantRecord[] } | { status: "missing" } | { status: "error"; error: string };

export async function readLegalConstantHistory(): Promise<LegalConstantHistory> {
  const { data, error } = await db()
    .from("legal_constants")
    .select("key, value, valid_from, note, source, created_at")
    .order("key")
    .order("valid_from", { ascending: false })
    .limit(1000);
  if (error) {
    const missing = error.code === "42P01" || error.code === "PGRST205" || /legal_constants|schema cache/i.test(error.message ?? "");
    return missing ? { status: "missing" } : { status: "error", error: error.message ?? "okunamadı" };
  }
  return { status: "ok", records: ((data ?? []) as Raw[]).map(toRecord) };
}

const cachedRecords = unstable_cache(
  async (): Promise<LegalConstantRecord[]> => {
    try {
      const h = await readLegalConstantHistory();
      return h.status === "ok" ? h.records : [];
    } catch {
      return [];
    }
  },
  ["legal-constants-records-v1"],
  { revalidate: 300, tags: [LEGAL_CONSTANTS_TAG] },
);

/**
 * Bugün (TR günü) ya da verilen gün geçerli tüm sabit değerleri: kayıt > kod. Sunucu tarafı tüketiciler için
 * (ör. yeni hesaplayıcı uç noktaları); okunamazsa koddaki değerler.
 */
export async function getEffectiveLegalValues(day: string = trDayKey()): Promise<Record<LegalKey, number>> {
  return resolveAllLegalValues(await cachedRecords(), day);
}

export async function insertLegalConstant(
  input: { key: LegalKey; value: number; validFrom: string; note: string | null; source: string | null },
  actorId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await db()
    .from("legal_constants")
    .insert({ key: input.key, value: input.value, valid_from: input.validFrom, note: input.note, source: input.source, created_by: actorId });
  if (!error) return { ok: true };
  if (error.code === "23505") return { ok: false, error: "Bu sabit için aynı geçerlilik tarihli kayıt zaten var; önce onu silin." };
  if (error.code === "42P01" || error.code === "PGRST205") return { ok: false, error: "Mevzuat sabiti tablosu henüz kurulmadı (migration bekliyor)." };
  return { ok: false, error: "Kaydedilemedi; tekrar deneyin." };
}

/** Yalnız henüz yürürlüğe girmemiş (geleceğe tarihli) kayıt silinir; geçmiş, hesap kanıtı olarak korunur. */
export async function deleteFutureLegalConstant(key: LegalKey, validFrom: string, today: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (validFrom <= today) return { ok: false, error: "Yürürlüğe girmiş kayıt silinemez; yeni tarihli kayıtla değiştirin." };
  const { error } = await db().from("legal_constants").delete().eq("key", key).eq("valid_from", validFrom).gt("valid_from", today);
  return error ? { ok: false, error: "Silinemedi; tekrar deneyin." } : { ok: true };
}
