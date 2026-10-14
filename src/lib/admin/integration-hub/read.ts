import "server-only";
import { access } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { daysAgoIso, trDayKey, trMonthKey } from "@/lib/clock";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformSecretsMany } from "@/lib/settings/secret-read";
import { secretFingerprint } from "@/lib/settings/secrets";
import { getPortalConfigs } from "@/lib/integrations/portals";
import { resolveEmailChannelConfig } from "@/lib/email/provider";
import { getEmlakFiyatiAdminStatus } from "@/lib/integrations/emlakfiyati/admin-status";
import { resolveEmlakFiyatiKeys } from "@/lib/integrations/emlakfiyati/keys";
import { getIyzicoConfig } from "@/lib/billing/iyzico";
import { evdsApiKey } from "@/lib/evds";
import { readConnectionView } from "@/lib/google/read";
import { normalizeAllowedWhatsAppApiUrl } from "@/lib/messaging/netgsm";
import { EXTENSION_PACKAGE_DIR, EXTENSION_VERSION, extensionStoreEnv, extensionZipFileName } from "@/lib/listing-control/worker/extension-release";
import { activityHref } from "@/lib/admin/activity-query";
import { CURRENT_PORTALS, PORTAL_LABELS, type CurrentPortal } from "@/lib/portals/catalog";
import {
  HUB_META,
  hostOf,
  INTEGRATIONS_HREF,
  LEGACY_TEST_ACTIONS,
  latest,
  lastTestsFrom,
  sortCards,
  type CallStats,
  type Fingerprint,
  type HubCard,
  type HubKey,
} from "./model";

/**
 * ENTEGRASYON MERKEZİ OKUYUCUSU (sunucu, service_role; yalnız platform personeli `sistem` modülü açarken çağrılır).
 * Dış servis ÇAĞRILMAZ (yalnız DB + ayar okuması); dış yoklama yalnız "Test et" düğmesiyle (`probe.ts`) yapılır.
 * Sır değerleri modelden çıkmaz: yalnız `secretFingerprint` parmak izi. Tablo/kolon eksikse ilgili bölüm boş düşer.
 */

const WINDOW_DAYS = 7;
const LATEST_DAYS = 30;
const OFFICE_ROWS = 200;
const DELIVERY_ROWS = 30;

type Admin = SupabaseClient;
type Q = ReturnType<Admin["from"]>;
type Filter = (q: ReturnType<Q["select"]>) => ReturnType<Q["select"]>;

const countOf = (r: { count: number | null; error: unknown }) => (r.error ? 0 : (r.count ?? 0));
const firstAt = (r: { data: unknown; error: unknown }, col: string): string | null => {
  if (r.error || !Array.isArray(r.data) || r.data.length === 0) return null;
  const v = (r.data[0] as Record<string, unknown>)[col];
  return typeof v === "string" ? v : null;
};

/**
 * Tek kaynak için 7 günlük başarılı/başarısız sayımı + son 30 günün en yeni başarılı/başarısız kaydı (4 küçük sorgu,
 * ikisi `head` sayım, ikisi `limit(1)`). Tablo yoksa sıfır/null.
 */
async function sourceStats(
  admin: Admin,
  table: string,
  timeCol: string,
  base: Filter,
  ok: Filter,
  fail: Filter,
): Promise<{ ok: number; fail: number; lastOkAt: string | null; lastFailAt: string | null }> {
  const since = daysAgoIso(WINDOW_DAYS);
  const latestSince = daysAgoIso(LATEST_DAYS);
  const head = () => base(admin.from(table).select("*", { count: "exact", head: true })).gte(timeCol, since);
  const last = () => base(admin.from(table).select(timeCol)).gte(timeCol, latestSince).order(timeCol, { ascending: false }).limit(1);
  const [okN, failN, okLast, failLast] = await Promise.all([ok(head()), fail(head()), ok(last()), fail(last())]);
  return { ok: countOf(okN), fail: countOf(failN), lastOkAt: firstAt(okLast, timeCol), lastFailAt: firstAt(failLast, timeCol) };
}

const fp = (label: string, storageKey: string, plain: string | null | undefined): Fingerprint[] =>
  plain ? [{ label, value: secretFingerprint(storageKey, plain) }] : [];

export type OfficeIntegrationRow = {
  id: string;
  tenantId: string;
  tenantName: string;
  provider: string;
  active: boolean;
  status: string;
  lastCheckedAt: string | null;
  lastError: string | null;
};

export type ApiKeyRow = { id: string; tenantId: string; tenantName: string; name: string; prefix: string; scopes: string[]; lastUsedAt: string | null; createdAt: string };

export type DeliveryRow = {
  id: string;
  tenantId: string;
  tenantName: string;
  endpointHost: string;
  event: string;
  status: string;
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: string;
};

export type IntegrationHub = {
  cards: HubCard[];
  offices: { rows: OfficeIntegrationRow[]; einvoice: OfficeIntegrationRow[]; available: boolean };
  apiKeys: { rows: ApiKeyRow[]; active: number; available: boolean };
  webhooks: {
    available: boolean;
    delivered: number;
    failed: number;
    pending: number;
    failingEndpoints: number;
    rows: DeliveryRow[];
  };
  /** Anahtar formlarının girdisi (değer yok; parmak izi + özet). */
  forms: {
    openai: { configured: boolean; source: "db" | "env" | "none"; fingerprint: string | null };
    portals: Record<CurrentPortal, { configured: boolean; fingerprint: string | null }>;
    messaging: { netgsmConfigured: boolean; netgsmSummary: string | null; whatsappConfigured: boolean; whatsappSummary: string | null };
  };
};

type TenantEmbed = { tenants?: { name?: string | null } | null };
const tenantName = (r: TenantEmbed) => r.tenants?.name ?? "Ofis";

export async function loadIntegrationHub(): Promise<IntegrationHub> {
  const admin = createAdminClient();
  const since = daysAgoIso(WINDOW_DAYS);
  const secretKeys = ["openai_api_key", "netgsm_password", "whatsapp_api_token"];
  const plainKeys = ["netgsm_usercode", "netgsm_msgheader", "whatsapp_api_url"];

  const [
    settings,
    portalConfigs,
    email,
    efStatus,
    efKeys,
    google,
    testRows,
    emailStats,
    iyzicoStats,
    netgsmStats,
    waStats,
    aiStats,
    transferStats,
    evdsRows,
    tcmbBeat,
    clients,
    pushCount,
    aiQuota,
    officeRows,
    einvoiceRows,
    apiKeyRows,
    apiKeyActive,
    wdDelivered,
    wdFailed,
    wdPending,
    wdRows,
    failingEndpoints,
    extensionZipReady,
  ] = await Promise.all([
    getPlatformSecretsMany([...secretKeys, ...plainKeys], secretKeys),
    getPortalConfigs(CURRENT_PORTALS),
    resolveEmailChannelConfig(),
    getEmlakFiyatiAdminStatus(),
    resolveEmlakFiyatiKeys(),
    readConnectionView(),
    admin
      .from("platform_audit_logs")
      .select("action, created_at, meta")
      .or(["action.like.integration.%.test", ...Object.keys(LEGACY_TEST_ACTIONS).map((a) => `action.eq.${a}`)].join(","))
      .order("created_at", { ascending: false })
      .limit(200),
    sourceStats(admin, "email_sends", "created_at", (q) => q, (q) => q.in("status", ["sent", "delivered", "delayed", "opened", "clicked"]), (q) => q.in("status", ["bounced", "complained", "failed"])),
    sourceStats(admin, "billing_payment_captures", "captured_at", (q) => q, (q) => q.in("status", ["fulfilled", "refunded"]), (q) => q.in("status", ["manual_review", "refund_required"])),
    sourceStats(admin, "webhook_events", "received_at", (q) => q.eq("provider", "netgsm"), (q) => q.in("status", ["processed", "ignored"]), (q) => q.in("status", ["failed", "quarantined"])),
    sourceStats(admin, "webhook_events", "received_at", (q) => q.in("provider", ["meta", "whatsapp"]), (q) => q.in("status", ["processed", "ignored"]), (q) => q.in("status", ["failed", "quarantined"])),
    sourceStats(admin, "audit_logs", "created_at", (q) => q.eq("action", "ai.openai_call"), (q) => q.eq("new_value->>outcome", "ok"), (q) => q.neq("new_value->>outcome", "ok")),
    sourceStats(admin, "portal_transfer_sessions", "created_at", (q) => q, (q) => q.in("state", ["filled", "published", "imported"]), (q) => q.eq("state", "failed")),
    admin.from("market_rates").select("fetched_at").in("key", ["housing_loan_rate_annual", "cpi_12m_avg"]),
    admin.from("cron_heartbeats").select("last_run_at, last_status").eq("job", "tcmb-kur").maybeSingle(),
    admin.from("verification_clients").select("last_seen_at").is("revoked_at", null).order("last_seen_at", { ascending: false, nullsFirst: false }).limit(OFFICE_ROWS),
    admin.from("push_subscriptions").select("*", { count: "exact", head: true }),
    admin.from("platform_ai_quota").select("key, period, used").eq("period", trMonthKey()),
    admin
      .from("tenant_integrations")
      .select("id, tenant_id, provider, is_active, connection_status, last_checked_at, last_error, tenants(name)")
      .order("updated_at", { ascending: false })
      .limit(OFFICE_ROWS),
    admin
      .from("einvoice_connections")
      .select("id, tenant_id, provider, status, last_test_at, last_test_ok, last_error, tenants(name)")
      .order("updated_at", { ascending: false })
      .limit(OFFICE_ROWS),
    admin
      .from("api_keys")
      .select("id, tenant_id, name, key_prefix, scopes, last_used_at, created_at, tenants(name)")
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(OFFICE_ROWS),
    admin.from("api_keys").select("*", { count: "exact", head: true }).is("revoked_at", null),
    admin.from("webhook_deliveries").select("*", { count: "exact", head: true }).eq("status", "delivered").gte("created_at", since),
    admin.from("webhook_deliveries").select("*", { count: "exact", head: true }).eq("status", "failed").gte("created_at", since),
    admin.from("webhook_deliveries").select("*", { count: "exact", head: true }).eq("status", "pending"),
    admin
      .from("webhook_deliveries")
      .select("id, tenant_id, event, status, attempts, last_status_code, last_error, created_at, tenants(name), webhook_endpoints(url)")
      .in("status", ["failed", "pending"])
      .order("created_at", { ascending: false })
      .limit(DELIVERY_ROWS),
    admin.from("webhook_endpoints").select("*", { count: "exact", head: true }).eq("active", true).gt("failure_count", 0),
    access(path.join(process.cwd(), EXTENSION_PACKAGE_DIR, extensionZipFileName())).then(() => true, () => false),
  ]);

  const tests = lastTestsFrom(((testRows.error ? [] : testRows.data) ?? []) as { action: string; created_at: string; meta: Record<string, unknown> | null }[]);
  const card = (key: HubKey, c: Omit<HubCard, "key" | "meta" | "lastTest">): HubCard => ({ key, meta: HUB_META[key], lastTest: tests[key] ?? null, ...c });
  const stats = (s: { ok: number; fail: number }, source: string, href: string): CallStats => ({ ok: s.ok, fail: s.fail, source, href });

  // --- iyzico (yalnız sunucu ortamı) ---
  const iyzico = getIyzicoConfig();
  const iyzicoLive = iyzico?.baseUrl === "https://api.iyzipay.com";

  // --- Netgsm / WhatsApp (panel öncelikli, ortam yedek) ---
  const netgsmUser = settings.netgsm_usercode?.trim() || process.env.NETGSM_USERCODE?.trim() || null;
  const netgsmHeader = settings.netgsm_msgheader?.trim() || process.env.NETGSM_MSGHEADER?.trim() || null;
  const netgsmPass = settings.netgsm_password?.trim() || process.env.NETGSM_PASSWORD?.trim() || null;
  const netgsmConfigured = Boolean(netgsmUser && netgsmPass && netgsmHeader);
  const waUrlRaw = settings.whatsapp_api_url?.trim() || process.env.WHATSAPP_API_URL?.trim() || null;
  const waToken = settings.whatsapp_api_token?.trim() || process.env.WHATSAPP_API_TOKEN?.trim() || null;
  const waUrl = waUrlRaw ? normalizeAllowedWhatsAppApiUrl(waUrlRaw) : null;
  const waConfigured = Boolean(waUrl && waToken);
  let waHost: string | null = null;
  try {
    waHost = waUrlRaw ? new URL(waUrlRaw).hostname : null;
  } catch {
    waHost = null;
  }

  // --- OpenAI ---
  const dbAi = settings.openai_api_key?.trim() || null;
  const envAi = process.env.OPENAI_API_KEY?.trim() || null;
  const aiKey = dbAi ?? envAi;
  const aiSource: "db" | "env" | "none" = dbAi ? "db" : envAi ? "env" : "none";
  const aiFingerprint = aiKey ? secretFingerprint(dbAi ? "openai_api_key" : "env:OPENAI_API_KEY", aiKey) : null;
  const quotaRows = ((aiQuota.error ? [] : aiQuota.data) ?? []) as { key: string; used: number }[];
  const quotaText = quotaRows.length ? quotaRows.map((r) => `${r.key}: ${r.used}`).join(" · ") : null;

  // --- EVDS ---
  const evdsKey = evdsApiKey();
  const evdsLastOk = latest(...(((evdsRows.error ? [] : evdsRows.data) ?? []) as { fetched_at: string | null }[]).map((r) => r.fetched_at));
  const beat = (tcmbBeat.error ? null : tcmbBeat.data) as { last_run_at: string; last_status: string } | null;

  // --- VAPID ---
  const vapidPub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() || null;
  const vapidPriv = process.env.VAPID_PRIVATE_KEY?.trim() || null;

  // --- Portal eklentisi ---
  const clientRows = ((clients.error ? [] : clients.data) ?? []) as { last_seen_at: string | null }[];
  const seenWeek = clientRows.filter((c) => c.last_seen_at && c.last_seen_at >= since).length;
  const store = extensionStoreEnv();

  // --- Google ---
  const gsc = google.services.find((s) => s.service === "gsc");
  const ads = google.services.find((s) => s.service === "ads");
  const googleCard = (key: "google_gsc" | "google_ads", svc: typeof gsc) =>
    card(key, {
      configured: Boolean(svc && svc.status !== "bagli_degil"),
      notes: [
        ...(svc ? [`Durum: ${svc.statusLabel}`] : []),
        ...(svc?.details ?? []).map((d) => `${d.label}: ${d.value}`),
        ...(google.client.configured ? [] : ["OAuth istemcisi girilmedi"]),
      ],
      alarm: svc?.status === "yeniden_bagla" ? "Google erişimi geri çekmiş: yeniden bağlayın" : google.readError ? "Bağlantı kaydı okunamadı" : null,
      fingerprints: [],
      lastOkAt: svc?.lastSyncAt ?? null,
      lastFailAt: null,
      stats: null,
      usage: svc?.status === "kota" ? { text: "Günlük kota doldu", href: "/admin/site/baglantilar" } : null,
    });

  // --- EmlakFiyati ---
  const efFp = efKeys.current ? secretFingerprint(efStatus.source === "env" ? "env:EMLAKFIYATI_API_KEY" : "emlakfiyati.api_key", efKeys.current) : null;

  // --- Portal API ---
  const portalFp = (p: CurrentPortal) => {
    const c = portalConfigs[p];
    return c ? secretFingerprint(`${p}_api_key`, c.apiKey) : null;
  };
  const portalsConfigured = CURRENT_PORTALS.filter((p) => portalConfigs[p]);

  const cards: HubCard[] = [
    card("iyzico", {
      configured: Boolean(iyzico),
      notes: iyzico ? [iyzicoLive ? "Canlı API (api.iyzipay.com)" : "Deneme ortamı (sandbox)", "Kaynak: sunucu ortamı"] : ["Demo mod: tahsilat yapılamaz"],
      alarm: null,
      fingerprints: iyzico ? [...fp("API anahtarı", "env:IYZICO_API_KEY", iyzico.apiKey), ...fp("Gizli anahtar", "env:IYZICO_SECRET_KEY", iyzico.secretKey)] : [],
      lastOkAt: iyzicoStats.lastOkAt,
      lastFailAt: iyzicoStats.lastFailAt,
      // 7 günlük sayı gösterilmez: tamamlanan tahsilatları listeleyen süzülmüş ekran yok (sıfır çıkmaz metrik).
      stats: null,
      usage: null,
    }),
    card("netgsm", {
      configured: netgsmConfigured,
      notes: [
        netgsmUser ? `Kullanıcı kodu: ${netgsmUser}${netgsmHeader ? ` · başlık ${netgsmHeader}` : ""}` : "Kullanıcı kodu yok",
        settings.netgsm_password ? "Parola: panel (şifreli)" : netgsmPass ? "Parola: sunucu ortamı" : "Parola yok",
      ],
      alarm: null,
      fingerprints: fp("Parola", settings.netgsm_password ? "netgsm_password" : "env:NETGSM_PASSWORD", netgsmPass),
      lastOkAt: netgsmStats.lastOkAt,
      lastFailAt: netgsmStats.lastFailAt,
      // webhook_events'i listeleyen admin ekranı yok → 7 günlük sayı gösterilmez; son başarılı/başarısız zaman kalır.
      stats: null,
      usage: tests.netgsm?.message?.startsWith("Kalan kredi") ? { text: tests.netgsm.message, href: `${INTEGRATIONS_HREF}#entegrasyon-netgsm` } : null,
    }),
    card("resend", {
      configured: email.enabled,
      notes: [
        email.keySource === "env" ? "Anahtar: sunucu ortamı" : email.keySource === "panel" ? "Anahtar: panel (şifreli)" : "Anahtar yok",
        ...(email.from ? [`Gönderen: ${email.from}`] : []),
        ...(email.reason ? [email.reason] : []),
      ],
      alarm: null,
      fingerprints: fp("API anahtarı", email.keySource === "env" ? "env:RESEND_API_KEY" : "email.resend_api_key", email.apiKey),
      lastOkAt: emailStats.lastOkAt,
      lastFailAt: emailStats.lastFailAt,
      stats: stats(emailStats, "gönderim günlüğü (sıçrayan/şikâyet/başarısız = hata)", "/admin/ayarlar/eposta?sekme=gunluk"),
      usage: null,
    }),
    card("whatsapp", {
      configured: waConfigured,
      notes: [waHost ? `API adresi: ${waHost}` : "API adresi yok", ...(waUrlRaw && !waUrl ? ["API adresi izin listesinde değil"] : [])],
      alarm: null,
      fingerprints: fp("Erişim belirteci", settings.whatsapp_api_token ? "whatsapp_api_token" : "env:WHATSAPP_API_TOKEN", waToken),
      lastOkAt: waStats.lastOkAt,
      lastFailAt: waStats.lastFailAt,
      stats: null,
      usage: null,
    }),
    googleCard("google_gsc", gsc),
    googleCard("google_ads", ads),
    card("openai", {
      configured: Boolean(aiKey),
      notes: [aiSource === "db" ? "Kaynak: panel (şifreli)" : aiSource === "env" ? "Kaynak: sunucu ortamı" : "Anahtar yok"],
      alarm: null,
      fingerprints: aiFingerprint ? [{ label: "API anahtarı", value: aiFingerprint }] : [],
      lastOkAt: aiStats.lastOkAt,
      lastFailAt: aiStats.lastFailAt,
      stats: stats(aiStats, "ofis AI çağrısı (denetim kaydı)", activityHref({ kaynak: "tenant", islem: "ai.openai_call", baslangic: trDayKey(since) })),
      usage: quotaText ? { text: `Platform AI kotası bu ay: ${quotaText}`, href: "/admin/ai-kullanim" } : { text: "Ofis kredi tüketimi", href: "/admin/ai-kullanim" },
    }),
    card("evds", {
      configured: Boolean(evdsKey),
      notes: [evdsKey ? "Kaynak: sunucu ortamı" : "EVDS_API_KEY tanımlı değil (isteğe bağlı)", ...(beat ? [`tcmb-kur cron: ${beat.last_status}`] : [])],
      alarm: null,
      fingerprints: fp("API anahtarı", "env:EVDS_API_KEY", evdsKey),
      lastOkAt: evdsLastOk,
      lastFailAt: beat?.last_status === "error" ? beat.last_run_at : null,
      stats: null,
      usage: null,
    }),
    card("vapid", {
      configured: Boolean(vapidPub && vapidPriv),
      notes: [vapidPub && vapidPriv ? "Kaynak: sunucu ortamı" : "Anahtar çifti eksik: anlık bildirim gönderilmez"],
      alarm: null,
      fingerprints: fp("Özel anahtar", "env:VAPID_PRIVATE_KEY", vapidPriv),
      lastOkAt: null,
      lastFailAt: null,
      stats: null,
      usage: { text: `${countOf(pushCount)} kayıtlı cihaz aboneliği`, href: `${INTEGRATIONS_HREF}#entegrasyon-vapid` },
    }),
    card("emlakfiyati", {
      configured: efStatus.configured,
      notes: [
        efStatus.source === "env" ? "Kaynak: sunucu ortamı" : efStatus.configured ? "Kaynak: panel (şifreli)" : "Anahtar yok",
        ...(efStatus.decryptFailed ? ["Kayıtlı anahtar çözülemiyor"] : []),
      ],
      alarm: efStatus.authAlarm ? "Anahtar reddedildi (401): yeni anahtar girin" : null,
      fingerprints: efFp ? [{ label: "API anahtarı", value: efFp }] : [],
      lastOkAt: efStatus.lastOkAt,
      lastFailAt: efStatus.lastErrorAt,
      stats: null,
      usage: { text: "Analiz tarifesi ve ofis bakiyeleri", href: "/admin/analiz-tarifesi" },
    }),
    card("portal_extension", {
      // Mağaza bağlantısı yokken sunucudaki ZIP paketiyle de dağıtılabilir → o durumda yapılandırılmış sayılır, not düşülür.
      configured: Boolean(store.chrome || store.edge || extensionZipReady),
      notes: [
        `Güncel sürüm ${EXTENSION_VERSION}`,
        store.chrome ? "Chrome mağaza bağlantısı tanımlı" : "Chrome mağaza bağlantısı yok (NEXT_PUBLIC_LISTING_EXTENSION_CWS_URL)",
        ...(store.edge ? ["Edge mağaza bağlantısı tanımlı"] : []),
        ...(!store.chrome && !store.edge ? [extensionZipReady ? "Yalnız ZIP paketiyle dağıtılıyor (mağaza bağlantısı yok)" : "İndirme paketi de sunucuda yok"] : []),
        `${clientRows.length} etkin eşleşme · ${seenWeek} tanesi son 7 günde görüldü`,
      ],
      alarm: null,
      fingerprints: [],
      lastOkAt: latest(clientRows[0]?.last_seen_at, transferStats.lastOkAt),
      lastFailAt: transferStats.lastFailAt,
      // Aktarım oturumlarını listeleyen ekran yok → 7 günlük sayı gösterilmez; son başarılı/başarısız zaman kalır.
      stats: null,
      usage: null,
    }),
    card("portal_api", {
      configured: portalsConfigured.length > 0,
      notes: [portalsConfigured.length ? `Bağlı: ${portalsConfigured.map((p) => PORTAL_LABELS[p] ?? p).join(", ")}` : "Hiçbir portal için kurumsal anahtar yok"],
      alarm: null,
      fingerprints: portalsConfigured.map((p) => ({ label: PORTAL_LABELS[p] ?? p, value: portalFp(p)! })),
      lastOkAt: null,
      lastFailAt: null,
      stats: null,
      usage: null,
    }),
  ];

  // --- Ofis bağlantıları ---
  type TiRow = { id: string; tenant_id: string; provider: string; is_active: boolean; connection_status: string; last_checked_at: string | null; last_error: string | null } & TenantEmbed;
  type EiRow = { id: string; tenant_id: string; provider: string; status: string; last_test_at: string | null; last_test_ok: boolean | null; last_error: string | null } & TenantEmbed;
  const offices = ((officeRows.error ? [] : officeRows.data) ?? []) as unknown as TiRow[];
  const einvoice = ((einvoiceRows.error ? [] : einvoiceRows.data) ?? []) as unknown as EiRow[];

  type AkRow = { id: string; tenant_id: string; name: string; key_prefix: string; scopes: string[] | null; last_used_at: string | null; created_at: string } & TenantEmbed;
  type WdRow = {
    id: string;
    tenant_id: string;
    event: string;
    status: string;
    attempts: number;
    last_status_code: number | null;
    last_error: string | null;
    created_at: string;
    webhook_endpoints?: { url?: string | null } | null;
  } & TenantEmbed;

  return {
    cards: sortCards(cards),
    offices: {
      available: !officeRows.error,
      rows: offices.map((r) => ({
        id: r.id,
        tenantId: r.tenant_id,
        tenantName: tenantName(r),
        provider: r.provider,
        active: r.is_active,
        status: r.connection_status,
        lastCheckedAt: r.last_checked_at,
        lastError: r.last_error ? r.last_error.slice(0, 160) : null,
      })),
      einvoice: einvoice.map((r) => ({
        id: r.id,
        tenantId: r.tenant_id,
        tenantName: tenantName(r),
        provider: `e-fatura · ${r.provider}`,
        // status yalnız active|error (CHECK); hatalı ya da son testi başarısız bağlantı "Sorunlu" sayılır.
        active: true,
        status: r.status === "error" || r.last_test_ok === false ? "degraded" : r.status,
        lastCheckedAt: r.last_test_at,
        lastError: r.last_error ? r.last_error.slice(0, 160) : null,
      })),
    },
    apiKeys: {
      available: !apiKeyRows.error,
      active: countOf(apiKeyActive),
      rows: (((apiKeyRows.error ? [] : apiKeyRows.data) ?? []) as unknown as AkRow[]).map((r) => ({
        id: r.id,
        tenantId: r.tenant_id,
        tenantName: tenantName(r),
        name: r.name,
        prefix: r.key_prefix,
        scopes: r.scopes ?? [],
        lastUsedAt: r.last_used_at,
        createdAt: r.created_at,
      })),
    },
    webhooks: {
      available: !wdRows.error,
      delivered: countOf(wdDelivered),
      failed: countOf(wdFailed),
      pending: countOf(wdPending),
      failingEndpoints: countOf(failingEndpoints),
      rows: (((wdRows.error ? [] : wdRows.data) ?? []) as unknown as WdRow[]).map((r) => ({
        id: r.id,
        tenantId: r.tenant_id,
        tenantName: tenantName(r),
        endpointHost: hostOf(r.webhook_endpoints?.url),
        event: r.event,
        status: r.status,
        attempts: r.attempts,
        lastStatusCode: r.last_status_code,
        lastError: r.last_error ? r.last_error.slice(0, 160) : null,
        createdAt: r.created_at,
      })),
    },
    forms: {
      openai: { configured: Boolean(aiKey), source: aiSource, fingerprint: aiFingerprint },
      portals: Object.fromEntries(
        CURRENT_PORTALS.map((p) => [p, { configured: Boolean(portalConfigs[p]), fingerprint: portalFp(p) }]),
      ) as Record<CurrentPortal, { configured: boolean; fingerprint: string | null }>,
      messaging: {
        netgsmConfigured,
        netgsmSummary: netgsmUser ? `${netgsmUser}${netgsmHeader ? ` · ${netgsmHeader}` : ""}` : null,
        whatsappConfigured: waConfigured,
        whatsappSummary: waHost,
      },
    },
  };
}
