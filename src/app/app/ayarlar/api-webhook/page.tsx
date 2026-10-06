import { PageHeader } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { requireModulePage } from "@/lib/require-module-page";
import { effectiveHasPermission } from "@/lib/permissions-effective";
import { createClient } from "@/lib/supabase/server";
import { getBaseUrl } from "@/lib/base-url";
import { formatDateTimeTr } from "@/lib/format";
import { API_RESOURCE_LABELS, WEBHOOK_EVENT_LABELS, isApiResource, isWebhookEvent } from "@/lib/integrations-api/core";
import { webhookSigningSecret } from "@/lib/integrations-api/webhooks";
import { ApiKeyCreateForm, ApiKeyRevokeButton, WebhookCreateForm, WebhookRowActions } from "./integration-forms";

export const metadata = { title: "API ve webhook" };

function dt(iso: string | null | undefined): string {
  return iso ? formatDateTimeTr(iso, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
}

/**
 * Ofis entegrasyonları: salt okunur açık API anahtarları + imzalı giden webhook'lar (müşteri/portföy/anlaşma oluştu/güncellendi).
 * Yalnız ayarlar:edit (owner/gm varsayılan). Anahtar özeti saklanır; webhook sırrı türetilir; WEBHOOK_SIGNING_SECRET yoksa kanal kapalı.
 */
export default async function ApiWebhookPage() {
  const { perms, tenantId } = await requireModulePage("settings", "/app/ayarlar/api-webhook");
  const canEdit = effectiveHasPermission(perms, "settings", "edit");
  const crumbs = [{ label: "Ayarlar", href: "/app/ayarlar" }, { label: "API ve webhook" }];
  if (!tenantId || !canEdit) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-4">
        <PageHeader title="API ve webhook" breadcrumbs={crumbs} />
        <Alert tone="info">Bu ekran yalnız Ayarlar düzenleme yetkisi olan ofis yöneticilerine açıktır.</Alert>
      </div>
    );
  }
  const supabase = await createClient();
  const [keysRes, endpointsRes, deliveriesRes] = await Promise.all([
    supabase.from("api_keys").select("id, name, key_prefix, scopes, created_at, last_used_at, revoked_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(50),
    supabase.from("webhook_endpoints").select("id, url, events, active, failure_count, last_status, last_delivery_at, created_at").eq("tenant_id", tenantId).order("created_at", { ascending: true }).limit(20),
    supabase.from("webhook_deliveries").select("id, endpoint_id, event, status, attempts, last_status_code, last_error, created_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(20),
  ]);
  const ready = !keysRes.error && !endpointsRes.error;
  const channelOpen = Boolean(webhookSigningSecret());
  const apiBase = `${getBaseUrl().replace(/\/$/, "")}/api/v1`;
  const keys = (keysRes.data ?? []) as { id: string; name: string; key_prefix: string; scopes: string[]; created_at: string; last_used_at: string | null; revoked_at: string | null }[];
  const endpoints = (endpointsRes.data ?? []) as { id: string; url: string; events: string[]; active: boolean; failure_count: number; last_status: number | null; last_delivery_at: string | null; created_at: string }[];
  const deliveries = (deliveriesRes.data ?? []) as { id: string; endpoint_id: string; event: string; status: string; attempts: number; last_status_code: number | null; last_error: string | null; created_at: string }[];

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <PageHeader
        eyebrow="Ayarlar"
        title="API ve webhook"
        description="Kendi web sitenizi, muhasebe veya reklam araçlarınızı EmlakSoft'a bağlayın: salt okunur API ile veri çekin, webhook ile değişikliklerden anında haberdar olun."
        breadcrumbs={crumbs}
      />
      {!ready ? (
        <Alert tone="warning">API ve webhook altyapısı henüz etkin değil (veritabanı güncellemesi bekleniyor).</Alert>
      ) : (
        <>
          <section aria-labelledby="api-anahtarlari" className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
            <h2 id="api-anahtarlari" className="font-display font-bold text-ink-950">API anahtarları (salt okunur)</h2>
            <p className="mt-1 text-xs text-text-muted">
              İstek: <code className="rounded bg-canvas px-1">GET {apiBase}/properties</code> · başlık{" "}
              <code className="rounded bg-canvas px-1">Authorization: Bearer es_…</code> · kaynaklar: properties, customers, deals · en çok 100 satır,
              sayfalama <code className="rounded bg-canvas px-1">?before=</code> ile. Örnek kayıtlar ve silinenler dönmez.
            </p>
            <ApiKeyCreateForm />
            {keys.length === 0 ? (
              <EmptyState variant="compact" title="Henüz anahtar yok." description="Anahtar oluşturunca tam değer yalnız bir kez gösterilir; güvenli bir yerde saklayın." />
            ) : (
              <ul className="mt-3 divide-y divide-line rounded-[var(--radius-card)] border border-line">
                {keys.map((k) => (
                  <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <div className="min-w-0">
                      <p className={`text-sm font-semibold ${k.revoked_at ? "text-text-faint line-through" : "text-ink-950"}`}>
                        {k.name} <code className="ml-1 text-xs font-normal text-text-muted">{k.key_prefix}_…</code>
                      </p>
                      <p className="text-xs text-text-muted">
                        {k.scopes.filter(isApiResource).map((s) => API_RESOURCE_LABELS[s]).join(", ")} · oluşturuldu {dt(k.created_at)} · son kullanım {dt(k.last_used_at)}
                        {k.revoked_at ? ` · iptal ${dt(k.revoked_at)}` : ""}
                      </p>
                    </div>
                    {!k.revoked_at ? <ApiKeyRevokeButton id={k.id} /> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="webhooklar" className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
            <h2 id="webhooklar" className="font-display font-bold text-ink-950">Webhook&apos;lar</h2>
            {!channelOpen ? (
              <Alert tone="warning" className="mt-3">
                Webhook kanalı kapalı: platform imza anahtarı tanımlı değil. Platform yöneticisi etkinleştirdiğinde buradan adres ekleyebilirsiniz.
              </Alert>
            ) : (
              <>
                <p className="mt-1 text-xs text-text-muted">
                  Her olay JSON olarak POST edilir. Doğrulama: <code className="rounded bg-canvas px-1">X-EmlakSoft-Signature: t=&lt;unix&gt;,v1=&lt;hmac&gt;</code> —
                  HMAC-SHA256(imza anahtarı, t + &quot;.&quot; + gövde). 5 dakikadan eski zaman damgasını reddedin. Başarısız teslimler 6 kez (artan aralıkla) yeniden denenir.
                </p>
                <WebhookCreateForm />
              </>
            )}
            {endpoints.length === 0 ? (
              <EmptyState variant="compact" title="Henüz webhook adresi yok." description="Yalnız https ve herkese açık alan adları kabul edilir." />
            ) : (
              <ul className="mt-3 divide-y divide-line rounded-[var(--radius-card)] border border-line">
                {endpoints.map((e) => (
                  <li key={e.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className={`truncate text-sm font-semibold ${e.active ? "text-ink-950" : "text-text-faint"}`}>{e.url}</p>
                        <p className="text-xs text-text-muted">
                          {e.events.filter(isWebhookEvent).map((ev) => WEBHOOK_EVENT_LABELS[ev]).join(", ")}
                          {" · "}son teslim {dt(e.last_delivery_at)}
                          {e.last_status ? ` (HTTP ${e.last_status})` : ""}
                          {e.failure_count > 0 ? ` · ${e.failure_count} ardışık hata` : ""}
                          {!e.active ? " · kapalı" : ""}
                        </p>
                      </div>
                      {channelOpen ? <WebhookRowActions id={e.id} active={e.active} /> : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {deliveries.length > 0 ? (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-semibold text-brand-600">Son 20 teslim</summary>
                <ul className="mt-2 space-y-1 text-xs text-text-muted">
                  {deliveries.map((d) => (
                    <li key={d.id}>
                      {dt(d.created_at)} · {d.event} ·{" "}
                      <span className={d.status === "delivered" ? "text-mint-700" : d.status === "failed" ? "text-danger-600" : "text-amber-700"}>
                        {d.status === "delivered" ? "teslim edildi" : d.status === "failed" ? "başarısız" : "bekliyor"}
                      </span>
                      {d.last_status_code ? ` · HTTP ${d.last_status_code}` : ""}
                      {d.last_error && d.status !== "delivered" ? ` · ${d.last_error}` : ""} · {d.attempts} deneme
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>
          <p className="text-xs text-text-faint">
            API anahtarı ve webhook adresleri ofisinizin kişisel verilerine erişim sağlar; yalnız güvendiğiniz sistemlere verin ve kullanılmayanı iptal edin.
            Aktarılan veriler için KVKK sorumluluğu ofisinizdedir.
          </p>
        </>
      )}
    </div>
  );
}
