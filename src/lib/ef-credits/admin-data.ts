import { createAdminClient } from "@/lib/supabase/admin";
import { EF_RPC, EF_UNIT, type EfBalance } from "@/lib/ef-credits/config";
import { parseEfBalance } from "@/lib/ef-credits/credit-view";
import type { EfAdminGrantInput } from "@/lib/ef-credits/admin-grant";

/**
 * Admin kontör verisi (service_role; çağıran action/sayfa requirePlatformModule geçmiştir).
 * Cüzdan yoksa hepsi "etkin değil" döner, fırlatmaz.
 */

export const ADMIN_BALANCE_PAGE_SIZE = 25;

export type TenantBalanceRow = { tenantId: string; name: string; balance: EfBalance | null };

/**
 * Ofis bazlı bakiye listesi. Varsayılan: kontör hareketi olan ofisler; `q` verilirse ad araması (tüm ofisler).
 * Sayfalama ofis listesi üzerindedir; her sayfa için bakiye RPC'si çağrılır (en çok 25).
 */
export async function listTenantEfBalances<X = null>(
  opts: {
    q?: string;
    page: number;
  },
  /**
   * Aynı service_role istemcisini (yeni createAdminClient çağrısı AÇMADAN) salt-okunur raporlara ödünç verir
   * (Kontör ekonomisi bölümü). Hata fırlatırsa `extra` null kalır; liste etkilenmez.
   */
  withAdmin?: (admin: ReturnType<typeof createAdminClient>) => Promise<X>,
): Promise<{ enabled: boolean; rows: TenantBalanceRow[]; total: number; extra: X | null }> {
  const empty = { enabled: false, rows: [] as TenantBalanceRow[], total: 0, extra: null as X | null };
  try {
    const admin = createAdminClient();
    let extra: X | null = null;
    if (withAdmin) {
      try {
        extra = await withAdmin(admin);
      } catch (e) {
        console.error("listTenantEfBalances.withAdmin", e);
      }
      empty.extra = extra;
    }
    const from = (opts.page - 1) * ADMIN_BALANCE_PAGE_SIZE;
    const to = from + ADMIN_BALANCE_PAGE_SIZE - 1;
    let tenants: { id: string; name: string | null }[] = [];
    let total = 0;
    const q = (opts.q ?? "").trim().replace(/[%,()]/g, " ").slice(0, 60);
    if (q) {
      const { data, count, error } = await admin
        .from("tenants")
        .select("id, name", { count: "exact" })
        .ilike("name", `%${q}%`)
        .order("name")
        .range(from, to);
      if (error) return empty;
      tenants = (data ?? []) as typeof tenants;
      total = count ?? tenants.length;
    } else {
      const { data, error } = await admin
        .from("account_credit_ledger")
        .select("tenant_id")
        .eq("unit", EF_UNIT)
        .order("created_at", { ascending: false })
        .limit(5000);
      if (error) return empty;
      const ids = [...new Set((data ?? []).map((r) => r.tenant_id as string))];
      total = ids.length;
      const pageIds = ids.slice(from, to + 1);
      if (pageIds.length > 0) {
        const { data: t } = await admin.from("tenants").select("id, name").in("id", pageIds);
        const byId = new Map((t ?? []).map((x) => [x.id as string, x as { id: string; name: string | null }]));
        tenants = pageIds.map((id) => byId.get(id) ?? { id, name: null });
      }
    }
    const rows = await Promise.all(
      tenants.map(async (t): Promise<TenantBalanceRow> => {
        const { data, error } = await admin.rpc(EF_RPC.balance, { p_tenant: t.id });
        return { tenantId: t.id, name: t.name ?? "(adsız ofis)", balance: error ? null : parseEfBalance(data) };
      }),
    );
    return { enabled: true, rows, total, extra };
  } catch (e) {
    console.error("listTenantEfBalances", e);
    return empty;
  }
}

export async function readTenantName(tenantId: string): Promise<string | null> {
  try {
    const admin = createAdminClient();
    const { data } = await admin.from("tenants").select("name").eq("id", tenantId).maybeSingle();
    return (data?.name as string | null) ?? null;
  } catch {
    return null;
  }
}

/**
 * Manuel yükleme: idempotency anahtarı FORMDAN gelen tek kullanımlık anahtardır (input.idemKey; personel + anahtar).
 * Aynı form gönderimi tekrarlanırsa (çift tıklama, ağ yeniden denemesi) ef_credit_grant `already` döner, ikinci kez yüklemez.
 */
export async function grantEfCredit(
  input: EfAdminGrantInput,
  staffId: string,
): Promise<{ ok: boolean; error?: string; available?: number }> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc(EF_RPC.grant, {
      p_tenant: input.tenantId,
      p_units: input.units,
      p_kind: input.kind,
      p_idem: `admin:${staffId}:${input.idemKey}`,
      p_meta: { reason: input.reason, staff_id: staffId, source: "admin_manual" },
    });
    if (error) {
      console.error("grantEfCredit", error.code, error.message);
      return { ok: false, error: "Kontör yüklenemedi: cüzdan henüz etkin olmayabilir." };
    }
    const r = (data ?? {}) as { ok?: boolean; available?: number };
    if (!r.ok) return { ok: false, error: "Kontör yüklenemedi." };
    return { ok: true, available: Number(r.available ?? 0) };
  } catch (e) {
    console.error("grantEfCredit", e);
    return { ok: false, error: "Kontör yüklenemedi." };
  }
}
