import Link from "@/components/ui/smart-link";
import { BellRing, CheckCircle2, ChevronDown, Radio, Send, ShieldAlert, XCircle } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { RegistrySettings } from "@/components/settings/registry-settings";
import { KpiCard, KpiGrid } from "@/components/ui/kpi-card";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { relativeTimeTR } from "@/lib/admin-format";
import { now as clockNow } from "@/lib/clock";
import { secretsWritable } from "@/lib/settings/secrets";
import { ALERT_CHANNEL_LABEL, type AlertChannelKind } from "@/lib/alerts/channel-config";
import { ALERT_RULE_KEYS, ALERT_RULES, isMuted, mergeRuleConfigs, type AlertRuleRow } from "@/lib/alerts/rules";
import { ALERT_ENGINE_HEARTBEAT } from "@/lib/alerts/engine";
import { OPS_ALERT_SETTING_KEYS } from "@/lib/settings/registry/ops-alerts";
import { AlertChannelActions, AlertChannelForm, AlertRuleEditor } from "./ops-controls";

type ChannelRow = {
  id: string;
  kind: AlertChannelKind;
  name: string;
  enabled: boolean;
  target_hint: string | null;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_test_detail: string | null;
};
type Delivery = { at: string; state: string; channel: string | null; kind: string | null; ok: boolean; detail: string };
type EventRow = {
  id: string;
  rule_key: string;
  severity: string;
  source: string;
  title: string;
  body: string | null;
  href: string | null;
  first_at: string;
  last_at: string;
  notify_count: number;
  resolved_at: string | null;
  deliveries: Delivery[] | null;
};

const BASE = "/admin/sistem?sekme=uyarilar";
const missing = (e: { code?: string } | null) => Boolean(e && (e.code === "42P01" || e.code === "PGRST205"));
const fmt = (iso: string) => new Date(iso).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Istanbul" });

/**
 * Sistem > Uyarılar: kanallar (Telegram / e-posta / webhook), kurallar (eşik, tekrar, sessize alma) ve olay günlüğü.
 * Kanal sırları ekrana hiç gelmez (yalnız maskeli hedef). `olay=acik|tumu` süzgeci URL'dedir.
 */
export async function AlertsView({ filter }: { filter?: string }) {
  const staff = await requirePlatformModule("sistem");
  const canEdit = staff.role === "super_admin";
  const onlyOpen = filter !== "tumu";
  const admin = createAdminClient();

  let eventsQ = admin
    .from("alert_events")
    .select("id, rule_key, severity, source, title, body, href, first_at, last_at, notify_count, resolved_at, deliveries")
    .order("last_at", { ascending: false })
    .limit(50);
  if (onlyOpen) eventsQ = eventsQ.is("resolved_at", null);

  const [chRes, ruleRes, evRes, openCountRes, engineRes] = await Promise.all([
    admin.from("alert_channels").select("id, kind, name, enabled, target_hint, last_test_at, last_test_ok, last_test_detail").order("created_at"),
    admin.from("alert_rules").select("key, enabled, threshold, repeat_minutes, muted_until"),
    eventsQ,
    admin.from("alert_events").select("id", { count: "exact", head: true }).is("resolved_at", null),
    admin.from("cron_heartbeats").select("last_run_at, last_status, last_detail").eq("job", ALERT_ENGINE_HEARTBEAT).maybeSingle(),
  ]);

  if (missing(chRes.error) || missing(ruleRes.error)) {
    return (
      <div className="space-y-6">
        <AdminPageHeader eyebrow="Operasyon" icon={BellRing} title="Uyarı merkezi" description="Telegram, e-posta ve webhook uyarıları." />
        <section className="rounded-[var(--radius-panel)] border border-dashed border-line-strong bg-surface px-6 py-10 text-center">
          <ShieldAlert className="mx-auto h-8 w-8 text-amber-600" />
          <h2 className="mt-3 font-display text-lg font-bold text-ink-950">Kurulum bekliyor</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-text-muted">
            Uyarı tabloları bu ortamda henüz yok (migration <code>20261013004900_ops_alerts.sql</code>). Uygulandığında kanallar ve kurallar burada
            yönetilir. Durum: <Link href="/admin/sistem#sema" className="font-semibold text-brand-600 hover:underline">şema denetimi</Link>.
          </p>
        </section>
      </div>
    );
  }

  const nowMs = clockNow();
  const channels = (chRes.data ?? []) as ChannelRow[];
  const rules = mergeRuleConfigs((ruleRes.data ?? []) as AlertRuleRow[]);
  const events = (evRes.data ?? []) as EventRow[];
  const openCount = openCountRes.count ?? 0;
  const activeChannels = channels.filter((c) => c.enabled).length;
  const mutedRules = ALERT_RULE_KEYS.filter((k) => isMuted(rules[k], nowMs)).length;
  const engine = (engineRes.data ?? null) as { last_run_at: string; last_status: string; last_detail: string | null } | null;
  const writable = secretsWritable();

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="Operasyon"
        icon={BellRing}
        title="Uyarı merkezi"
        description="Site kesintisi, cron gecikmesi/hatası, hata patlaması, yedek, disk, ödeme yakalama ve MRR düşüşü uyarıları. Kanal eklenene kadar dışarıya hiçbir şey gönderilmez."
      >
        <KpiGrid label="Uyarı göstergeleri" className="lg:grid-cols-4 2xl:grid-cols-4">
          <KpiCard layout="inline" label="Açık uyarı" value={openCount} href={`${BASE}#olaylar`} icon={ShieldAlert} tone={openCount > 0 ? "danger" : "success"} attention={openCount > 0} />
          <KpiCard
            layout="inline"
            label="Etkin kanal"
            value={activeChannels}
            href={`${BASE}#kanallar`}
            icon={Send}
            tone={activeChannels > 0 ? "success" : "warn"}
            attention={activeChannels === 0}
            hint={activeChannels === 0 ? "kanal kapalı: bildirim gitmez" : undefined}
          />
          <KpiCard layout="inline" label="Sessizdeki kural" value={mutedRules} href={`${BASE}#kurallar`} icon={BellRing} tone={mutedRules > 0 ? "warn" : "brand"} />
          <KpiCard
            layout="inline"
            label="Motor son tur"
            value={engine ? relativeTimeTR(engine.last_run_at) : "henüz yok"}
            href="/admin/sistem#cron-ticket-sla"
            icon={Radio}
            tone={engine?.last_status === "error" ? "danger" : engine ? "success" : "warn"}
            hint={engine?.last_detail ? engine.last_detail.slice(0, 60) : "ticket-sla cron'u içinde, 5 dk'da bir"}
          />
        </KpiGrid>
      </AdminPageHeader>

      {/* Kanallar */}
      <section id="kanallar" className="scroll-mt-24 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
        <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
          <Send className="h-4 w-4" /> Kanallar
        </p>
        <h2 className="mt-1 font-display font-bold text-ink-950">Uyarı nereye gitsin?</h2>
        {channels.length === 0 ? (
          <p className="mt-3 text-sm text-text-muted">
            Henüz kanal yok. Uyarılar olay günlüğüne düşer ama hiçbir yere gönderilmez (<strong>kanal kapalı</strong>).
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {channels.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink-950">
                    {c.name}{" "}
                    <span className="ml-1 rounded-full bg-canvas px-2 py-0.5 text-xs font-bold text-text-muted">{ALERT_CHANNEL_LABEL[c.kind] ?? c.kind}</span>
                    {!c.enabled ? <span className="ml-1 rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-bold text-amber-700">kapalı</span> : null}
                  </p>
                  <p className="truncate text-xs text-text-faint">
                    {c.target_hint ?? "—"}
                    {c.last_test_at ? (
                      <>
                        {" · son deneme "}
                        {relativeTimeTR(c.last_test_at)}:{" "}
                        <span className={c.last_test_ok ? "font-semibold text-mint-700" : "font-semibold text-danger-600"}>
                          {c.last_test_ok ? "başarılı" : (c.last_test_detail ?? "başarısız")}
                        </span>
                      </>
                    ) : (
                      " · henüz denenmedi"
                    )}
                  </p>
                </div>
                {canEdit ? <AlertChannelActions id={c.id} name={c.name} enabled={c.enabled} /> : null}
              </li>
            ))}
          </ul>
        )}
        {canEdit ? (
          <div className="mt-4">
            {writable ? (
              <AlertChannelForm />
            ) : (
              <p className="rounded-[var(--radius-card)] border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Şifreleme anahtarı tanımlı değil (PLATFORM_SECRETS_KEY); kanal sırları düz metin saklanmayacağı için kanal eklenemez.
              </p>
            )}
          </div>
        ) : (
          <p className="mt-3 text-xs text-text-faint">Kanalları yalnız süper admin ekleyip değiştirebilir.</p>
        )}
      </section>

      {/* Kurallar */}
      <section id="kurallar" className="scroll-mt-24 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
        <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
          <BellRing className="h-4 w-4" /> Kurallar
        </p>
        <h2 className="mt-1 font-display font-bold text-ink-950">Ne zaman uyarılsın?</h2>
        <ul className="mt-4 divide-y divide-line">
          {ALERT_RULE_KEYS.map((key) => {
            const def = ALERT_RULES[key];
            const cfg = rules[key];
            const muted = isMuted(cfg, nowMs);
            return (
              <li key={key} id={`kural-${key}`} className="scroll-mt-24 space-y-2 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-ink-950">
                    {def.label}
                    {!cfg.enabled ? <span className="ml-2 rounded-full bg-canvas px-2 py-0.5 text-xs font-bold text-text-muted">kapalı</span> : null}
                    {muted && cfg.mutedUntil ? (
                      <span className="ml-2 rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-bold text-amber-700">sessiz: {fmt(cfg.mutedUntil)}&apos;e kadar</span>
                    ) : null}
                  </p>
                  <span className="text-xs text-text-faint">
                    {def.evaluatedBy === "host" ? "sunucu betiği (error-watch)" : "uygulama motoru"} · tekrar {cfg.repeatMinutes} dk
                    {def.threshold ? ` · eşik ${cfg.threshold} ${def.threshold.unit}` : ""}
                  </span>
                </div>
                <p className="text-xs text-text-muted">{def.description}</p>
                {canEdit ? (
                  <AlertRuleEditor
                    ruleKey={key}
                    enabled={cfg.enabled}
                    threshold={cfg.threshold}
                    thresholdMeta={def.threshold}
                    repeatMinutes={cfg.repeatMinutes}
                    muted={muted}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      {/* Olaylar */}
      <section id="olaylar" className="scroll-mt-24 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
              <ShieldAlert className="h-4 w-4" /> Olay günlüğü
            </p>
            <h2 className="mt-1 font-display font-bold text-ink-950">{onlyOpen ? "Açık uyarılar" : "Son 50 uyarı"}</h2>
          </div>
          <nav aria-label="Olay süzgeci" className="flex gap-2 text-xs font-semibold">
            <Link href={`${BASE}#olaylar`} aria-current={onlyOpen ? "page" : undefined} className={onlyOpen ? "text-ink-950 underline" : "text-brand-600 hover:underline"}>
              Açık
            </Link>
            <Link href={`${BASE}&olay=tumu#olaylar`} aria-current={!onlyOpen ? "page" : undefined} className={!onlyOpen ? "text-ink-950 underline" : "text-brand-600 hover:underline"}>
              Tümü
            </Link>
          </nav>
        </div>
        {events.length === 0 ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-mint-700">
            <CheckCircle2 className="h-4 w-4" /> {onlyOpen ? "Açık uyarı yok." : "Henüz uyarı kaydı yok."}
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {events.map((e) => {
              const deliveries = Array.isArray(e.deliveries) ? e.deliveries : [];
              const lastDelivery = deliveries.at(-1);
              return (
                <li key={e.id} className="rounded-[var(--radius-card)] border border-line bg-canvas p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink-950">
                        {e.resolved_at ? (
                          <CheckCircle2 className="mr-1 inline h-3.5 w-3.5 text-mint-600" />
                        ) : (
                          <XCircle className="mr-1 inline h-3.5 w-3.5 text-danger-500" />
                        )}
                        {e.href ? (
                          <Link href={e.href} className="hover:underline">
                            {e.title}
                          </Link>
                        ) : (
                          e.title
                        )}
                      </p>
                      {e.body ? <p className="mt-0.5 text-xs text-text-muted">{e.body}</p> : null}
                    </div>
                    <span className="text-xs text-text-faint">
                      {ALERT_RULES[e.rule_key as keyof typeof ALERT_RULES]?.label ?? e.rule_key} · {e.source === "host" ? "sunucu" : "uygulama"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-text-faint">
                    ilk {fmt(e.first_at)} · son {relativeTimeTR(e.last_at)}
                    {e.resolved_at ? ` · düzeldi ${relativeTimeTR(e.resolved_at)}` : ""} · {e.notify_count} bildirim
                    {lastDelivery ? (
                      <span className={lastDelivery.ok ? "text-mint-700" : "text-amber-700"}> · son teslim: {lastDelivery.detail}</span>
                    ) : null}
                  </p>
                  {deliveries.length > 0 ? (
                    <details className="group mt-1">
                      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 text-xs font-semibold text-text-muted [&::-webkit-details-marker]:hidden">
                        <ChevronDown className="h-3 w-3 transition group-open:rotate-180" /> Teslim günlüğü ({deliveries.length})
                      </summary>
                      <ul className="mt-1 space-y-0.5 text-xs text-text-muted">
                        {deliveries
                          .slice()
                          .reverse()
                          .map((d, i) => (
                            <li key={`${d.at}-${i}`}>
                              {fmt(d.at)} · {d.state} · {d.channel ?? "—"}:{" "}
                              <span className={d.ok ? "text-mint-700" : "text-danger-600"}>{d.detail}</span>
                            </li>
                          ))}
                      </ul>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <RegistrySettings
        title="Uyarı motoru"
        description="Genel anahtar ve saklama süreleri. Değişiklikler doğrulanır, gerekçesiyle geçmişe yazılır ve geri alınabilir."
        keys={Object.values(OPS_ALERT_SETTING_KEYS)}
        canEdit={canEdit}
      />
    </div>
  );
}
