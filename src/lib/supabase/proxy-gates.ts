import type { SupabaseClient } from "@supabase/supabase-js";
import { recordRpcOutcome, rpcKnownMissing } from "@/lib/supabase/rpc-probe";

/**
 * Proxy kapı okumaları: profil + aktif platform personeli + ofis durumu.
 * Hızlı yol: tek SECURITY INVOKER RPC (`proxy_gate_snapshot`, RLS eski okumalarla aynı). RPC yoksa
 * (migration uygulanmamış: PGRST202/42883) ya da herhangi bir hata/bozuk yanıt olursa eski üç paralel sorguya
 * sessizce düşülür — sonuç şekli iki yolda birebir aynıdır.
 */
export type ProxyProfile = {
  tenant_id: string | null;
  role: string | null;
  is_active: boolean | null;
  two_factor_sms: boolean | null;
  phone: string | null;
  two_factor_version: number | null;
};

export type ProxyGateData = {
  profile: ProxyProfile | null;
  profileError: boolean;
  /** Aktif platform personeli satırı görünüyor mu (eski: `{id}` ya da null). */
  staff: boolean;
  /** Ofis durumu; tenantId yok ya da satır görünmüyorsa null. */
  tenantStatus: string | null;
};

export const PROXY_GATE_RPC = "proxy_gate_snapshot";

function parseSnapshot(data: unknown): ProxyGateData | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as { profile?: unknown; staff?: unknown; tenant_status?: unknown };
  if (typeof d.staff !== "boolean") return null;
  const profile = d.profile && typeof d.profile === "object" ? (d.profile as ProxyProfile) : null;
  return {
    profile,
    profileError: false,
    staff: d.staff,
    tenantStatus: typeof d.tenant_status === "string" ? d.tenant_status : null,
  };
}

export async function readProxyGateData(
  supabase: SupabaseClient,
  userId: string,
  tenantId: string,
): Promise<ProxyGateData> {
  if (!rpcKnownMissing(PROXY_GATE_RPC)) {
    try {
      const { data, error } = await supabase.rpc(PROXY_GATE_RPC, {
        p_user_id: userId,
        p_tenant_id: tenantId || null,
      });
      recordRpcOutcome(PROXY_GATE_RPC, error);
      if (!error) {
        const parsed = parseSnapshot(data);
        if (parsed) return parsed;
      }
      // Fonksiyon yok / hata / bozuk yanıt: eski yola düş (aşağıda).
    } catch {
      // Ağ/istemci hatası: eski yol karar verir.
    }
  }

  const [{ data: profile, error: profileError }, { data: staff }, { data: tenant }] = await Promise.all([
    supabase
      .from("profiles")
      .select("tenant_id, role, is_active, two_factor_sms, phone, two_factor_version")
      .eq("id", userId)
      .maybeSingle(),
    supabase.from("platform_staff").select("id").eq("id", userId).eq("is_active", true).maybeSingle(),
    tenantId
      ? supabase.from("tenants").select("status").eq("id", tenantId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  return {
    profile: (profile as ProxyProfile | null) ?? null,
    profileError: Boolean(profileError),
    staff: Boolean(staff),
    tenantStatus: (tenant as { status?: string } | null)?.status ?? null,
  };
}
