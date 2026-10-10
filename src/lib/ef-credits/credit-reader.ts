import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformSettingsMany } from "@/lib/platform-settings";
import {
  EF_PACKS_SETTING_KEY,
  EF_RPC,
  EF_TARIFF_SETTING_KEY,
  EF_UNIT,
  parseEfPacks,
  parseEfTariff,
  type EfBalance,
  type EfPack,
  type EfTariff,
} from "@/lib/ef-credits/config";
import { normalizeLedgerRow, parseEfBalance, type EfMovement } from "@/lib/ef-credits/credit-view";

/**
 * Kontör OKUYUCULARI (ofis + admin). Cüzdan SQL'i yoksa/hata verirse hepsi "etkin değil" döner, ASLA fırlatmaz.
 * `wallet.ts`/`service.ts` başka ajanın dosyalarıdır; bu dosya yalnız okuma ve hazırlık yoklamasıdır.
 * Okuma service_role ile yapılır; çağıran sayfa kendi yetki kapısını geçmiştir ve tenant kimliği oturumdan gelir.
 */

/** Cüzdan hazır mı? SQL tarafındaki `ef_credit_ready()` (true = RPC'ler + fulfill credit_pack dalı hazır). */
export const EF_READY_RPC = "ef_credit_ready";
/** Süreli kontör partileri hazır mı (20261010000300)? false iken paket SATIŞI kapalı kalır; bakiye/harcama eski akışla sürer. */
export const EF_LOTS_READY_RPC = "ef_credit_lots_ready";
export const EF_CONFIG_CACHE_TAG = "ef-credit-config";
const HISTORY_FETCH_LIMIT = 1000;

const cachedReady = () =>
  unstable_cache(
    async (): Promise<{ wallet: boolean; lots: boolean }> => {
      try {
        const admin = createAdminClient();
        const { data, error } = await admin.rpc(EF_READY_RPC);
        const wallet = !error && data === true;
        if (!wallet) return { wallet: false, lots: false };
        // Süreli parti şeması yoksa (RPC yok/hata) lots=false: paket satışı kapalı, geri kalanı eski akışla çalışır.
        const lots = await admin.rpc(EF_LOTS_READY_RPC);
        return { wallet, lots: !lots.error && lots.data === true };
      } catch (e) {
        console.error("getEfCreditReady", e);
        return { wallet: false, lots: false };
      }
    },
    ["ef-credit-ready-v2"],
    { revalidate: 60 },
  );

async function readReadiness(): Promise<{ wallet: boolean; lots: boolean }> {
  try {
    return await cachedReady()();
  } catch (e) {
    console.error("getEfCreditReady cache", e);
    return { wallet: false, lots: false };
  }
}

/** Hata/şema yok = false (para tahsil eden yollar kapalı kalır). */
export async function getEfCreditReady(): Promise<boolean> {
  return (await readReadiness()).wallet;
}

/** Süreli kontör partileri (20261010000300) hazır mı? Paket satışı bunu bekler; hata/şema yok = false. */
export async function getEfLotsReady(): Promise<boolean> {
  return (await readReadiness()).lots;
}

export type EfCatalog = { tariff: EfTariff; packs: EfPack[] };

const cachedCatalog = () =>
  unstable_cache(
    async (): Promise<{ tariffRaw: string | null; packsRaw: string | null }> => {
      const s = await getPlatformSettingsMany([EF_TARIFF_SETTING_KEY, EF_PACKS_SETTING_KEY]);
      return { tariffRaw: s[EF_TARIFF_SETTING_KEY] ?? null, packsRaw: s[EF_PACKS_SETTING_KEY] ?? null };
    },
    ["ef-credit-catalog-v1"],
    { revalidate: 60, tags: [EF_CONFIG_CACHE_TAG] },
  );

/** Tarife + paket kataloğu (platform_settings). Kayıt yoksa varsayılan tarife ve BOŞ katalog. */
export async function getEfCatalog(): Promise<EfCatalog> {
  try {
    const raw = await cachedCatalog()();
    return { tariff: parseEfTariff(raw.tariffRaw), packs: parseEfPacks(raw.packsRaw) };
  } catch (e) {
    console.error("getEfCatalog", e);
    return { tariff: parseEfTariff(null), packs: [] };
  }
}

/** Süresi dolmamış kontör partisi (görünüm; kişisel veri yok). */
export type EfLot = { id: string; kind: string; units: number; remaining: number; expiresAt: string };
/** Bakiye + (şema varsa) süreli partiler. `lots` null = partiler şeması yok/okunamadı (eski akış; son kullanma gösterilmez). */
export type EfBalanceWithLots = EfBalance & { lots: EfLot[] | null };

/** Ofisin kontör bakiyesi ve süreli partileri; cüzdan yoksa null. */
export async function readEfBalance(tenantId: string): Promise<EfBalanceWithLots | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc(EF_RPC.balance, { p_tenant: tenantId });
    if (error) return null;
    const balance = parseEfBalance(data);
    if (!balance) return null;
    let lots: EfLot[] | null = null;
    try {
      const res = await admin
        .from("ef_credit_lots")
        .select("id, kind, units, remaining, expires_at")
        .eq("tenant_id", tenantId)
        .gt("remaining", 0)
        .order("expires_at", { ascending: true })
        .limit(50);
      if (!res.error) {
        lots = ((res.data ?? []) as { id: string; kind: string; units: number; remaining: number; expires_at: string }[]).map((r) => ({
          id: r.id,
          kind: r.kind,
          units: Number(r.units),
          remaining: Number(r.remaining),
          expiresAt: r.expires_at,
        }));
      }
    } catch {
      lots = null;
    }
    return { ...balance, lots };
  } catch (e) {
    console.error("readEfBalance", e);
    return null;
  }
}

export type EfHistory = { enabled: boolean; rows: EfMovement[]; userNames: Record<string, string>; truncated: boolean };

/** Ofisin kontör hareketleri (yeniden eskiye, en çok 1000 satır; süzgeç/sayfalama saf `filterAndPage`). */
export async function readEfHistory(tenantId: string): Promise<EfHistory> {
  const empty: EfHistory = { enabled: false, rows: [], userNames: {}, truncated: false };
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("account_credit_ledger")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("unit", EF_UNIT)
      .order("created_at", { ascending: false })
      .limit(HISTORY_FETCH_LIMIT);
    if (error) return empty;
    const raw = (data ?? []) as Record<string, unknown>[];
    const rows = raw.map(normalizeLedgerRow).filter((r): r is EfMovement => r !== null);
    const ids = [...new Set(rows.map((r) => r.userId).filter((v): v is string => !!v))];
    const userNames: Record<string, string> = {};
    if (ids.length > 0) {
      const { data: profs } = await admin.from("profiles").select("id, full_name").eq("tenant_id", tenantId).in("id", ids);
      for (const p of profs ?? []) userNames[p.id as string] = (p.full_name as string | null) || "Kullanıcı";
    }
    return { enabled: true, rows, userNames, truncated: raw.length >= HISTORY_FETCH_LIMIT };
  } catch (e) {
    console.error("readEfHistory", e);
    return empty;
  }
}

/** Ofisin en son kontör paketi faturası (RLS'li istemci): ödeme sonrası dönüş mesajı için. */
export async function loadLatestPackInvoice(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<{ status: string; createdAt: string; paidAt: string | null; units: number | null } | null> {
  try {
    const { data, error } = await supabase
      .from("invoices")
      .select("status, created_at, paid_at, meta")
      .eq("tenant_id", tenantId)
      .eq("meta->>kind", "credit_pack")
      .order("created_at", { ascending: false })
      .limit(1);
    const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
    if (error || !row) return null;
    const meta = (row.meta ?? {}) as Record<string, unknown>;
    const units = Number(meta.units);
    return {
      status: String(row.status ?? ""),
      createdAt: String(row.created_at ?? ""),
      paidAt: typeof row.paid_at === "string" ? row.paid_at : null,
      units: Number.isFinite(units) ? units : null,
    };
  } catch {
    return null;
  }
}
