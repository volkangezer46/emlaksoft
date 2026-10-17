import type { SupabaseClient } from "@supabase/supabase-js";
import { recordRpcOutcome, rpcKnownMissing } from "@/lib/supabase/rpc-probe";
import {
  isPlatformBaseRole,
  normalizeMatrix,
  type PlatformModule,
  type PlatformPrincipal,
  type PlatformRole,
} from "@/lib/platform-access";

/**
 * Proxy kapı okumaları: profil + aktif platform personeli + ofis durumu + oturum canlılığı.
 * Hızlı yol: tek SECURITY INVOKER RPC (`proxy_gate_snapshot`, RLS eski okumalarla aynı). RPC yoksa
 * (migration uygulanmamış: PGRST202/42883) ya da herhangi bir hata/bozuk yanıt olursa eski üç paralel sorguya
 * sessizce düşülür — sonuç şekli iki yolda birebir aynıdır (eski yolda oturum canlılığı ve personel rolü bilinmez: null).
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
  /**
   * SK1: oturum (JWT `session_id`) auth.sessions'ta hâlâ var ve süresi dolmamış mı. false = çıkış yapılmış / iptal
   * edilmiş → proxy reddeder. null = bilinmiyor (eski RPC gövdesi, eski yol ya da claim'de session_id yok) → geçer.
   */
  sessionAlive: boolean | null;
  /** SK1/B122: personelin yetki öznesi (taban rol + özel rol matrisi); bilinmiyorsa null (proxy modül kapısı atlanır). */
  staffAccess: PlatformPrincipal | null;
};

export const PROXY_GATE_RPC = "proxy_gate_snapshot";

const PLATFORM_ROLES: readonly PlatformRole[] = ["super_admin", "ops", "support", "billing"];

/**
 * RPC'deki `staff_access` → yetki öznesi. `staffFromRow` (platform.ts) ile aynı FAIL-CLOSED kural: özel rol atanmış ama
 * okunamamışsa taban rolün yetkileri VERİLMEZ (boş matris = yalnız Genel bakış).
 */
export function staffAccessFromSnapshot(raw: unknown): PlatformPrincipal | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as { role?: unknown; custom_role_id?: unknown; custom_role?: unknown };
  if (typeof r.role !== "string" || !(PLATFORM_ROLES as readonly string[]).includes(r.role)) return null;
  const role = r.role as PlatformRole;
  if (typeof r.custom_role_id !== "string" || !r.custom_role_id) return { role, customRole: null };
  const c = r.custom_role && typeof r.custom_role === "object" ? (r.custom_role as Record<string, unknown>) : null;
  return {
    role,
    customRole: c
      ? {
          id: String(c.id ?? r.custom_role_id),
          label: typeof c.label === "string" ? c.label : "Özel rol",
          baseRole: isPlatformBaseRole(c.base_role) ? c.base_role : "support",
          permissions: normalizeMatrix(c.permissions),
        }
      : { id: r.custom_role_id, label: "Özel rol (okunamadı)", baseRole: "support", permissions: {} },
  };
}

function parseSnapshot(data: unknown): ProxyGateData | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as { profile?: unknown; staff?: unknown; tenant_status?: unknown; session_alive?: unknown; staff_access?: unknown };
  if (typeof d.staff !== "boolean") return null;
  const profile = d.profile && typeof d.profile === "object" ? (d.profile as ProxyProfile) : null;
  return {
    profile,
    profileError: false,
    staff: d.staff,
    tenantStatus: typeof d.tenant_status === "string" ? d.tenant_status : null,
    sessionAlive: typeof d.session_alive === "boolean" ? d.session_alive : null,
    staffAccess: d.staff ? staffAccessFromSnapshot(d.staff_access) : null,
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
    sessionAlive: null,
    staffAccess: null,
  };
}

/**
 * SK1/B122: /admin sayfa yolu → sayfanın `requirePlatformModule` modülü (en uzun önek kazanır). Proxy, kabuk akmadan önce
 * bu modülü personelin matrisiyle (görüntüle) denetler ve yetkisiz isteği 307 ile `/admin?yetki=yok&sayfa=<modül>`'e
 * yollar. Sayfa kendi kapısını AYRICA çalıştırır (bu yalnız erken ret). Sözleşme: middleware-gates.test.ts her admin
 * page.tsx'in `requirePlatformModule("x")` modülünün bu tabloyla eşleştiğini ve kapısız sayfaların eşleşmediğini sınar.
 */
const ADMIN_PATH_MODULES: ReadonlyArray<readonly [string, PlatformModule]> = [
  ["/admin/ai-kullanim", "billing"],
  ["/admin/aktivite", "activity"],
  ["/admin/analiz-tarifesi", "billing"],
  ["/admin/ayarlar", "sistem"],
  ["/admin/billing", "billing"],
  ["/admin/danisman", "advisor"],
  ["/admin/duyuru", "broadcast"],
  ["/admin/geo", "geo"],
  ["/admin/giris-guvenligi", "members"],
  ["/admin/gorevler", "tenants"],
  ["/admin/ileti-izni", "members"],
  ["/admin/kuyruklar", "sistem"],
  ["/admin/members", "members"],
  ["/admin/ofis-sagligi", "tenants"],
  ["/admin/ortaklik", "sales"],
  ["/admin/personel", "personel"],
  ["/admin/portal-hesaplari", "sistem"],
  ["/admin/raporlar", "reports"],
  ["/admin/sistem", "sistem"],
  ["/admin/site/baglantilar", "reklam"],
  ["/admin/site/hiz", "sitecontent"],
  ["/admin/site/marka", "marka"],
  ["/admin/site/medya", "sitecontent"],
  ["/admin/site/menu", "sitemenu"],
  ["/admin/site/rehber", "sitecontent"],
  ["/admin/site/reklam", "reklam"],
  ["/admin/site/sayfalar", "sitecontent"],
  ["/admin/site/seo", "seo"],
  ["/admin/tenants/kurulum", "sales"],
  ["/admin/tenants", "tenants"],
  ["/admin/tickets/kvkk", "members"],
  ["/admin/tickets/yardim", "sitecontent"],
  ["/admin/tickets", "tickets"],
  ["/admin/veri-saklama", "sistem"],
];

export function adminPathModule(path: string): PlatformModule | null {
  let best: readonly [string, PlatformModule] | null = null;
  for (const entry of ADMIN_PATH_MODULES) {
    const [prefix] = entry;
    if ((path === prefix || path.startsWith(`${prefix}/`)) && (!best || prefix.length > best[0].length)) best = entry;
  }
  return best ? best[1] : null;
}

/** Yetkisiz admin sayfasının gideceği hafif açıklama kartı (src/app/admin/page.tsx). */
export function adminDeniedHref(module: PlatformModule): string {
  return `/admin?yetki=yok&sayfa=${encodeURIComponent(module)}`;
}
