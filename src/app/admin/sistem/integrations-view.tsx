import Link from "@/components/ui/smart-link";
import { ArrowUpRight, Building2, CheckCircle2, CircleOff, Fingerprint, KeyRound, PlugZap, Webhook, XCircle, AlertTriangle } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { KpiCard, KpiGrid } from "@/components/ui/kpi-card";
import { OpenAiKeyForm } from "@/components/admin/openai-key-form";
import { PortalApiKeysSection } from "@/components/admin/portal-keys-form";
import { requirePlatformModule } from "@/lib/platform";
import { relativeTimeTR } from "@/lib/admin-format";
import { loadIntegrationHub, type OfficeIntegrationRow } from "@/lib/admin/integration-hub/read";
import {
  HUB_CATEGORY_LABELS,
  TONE_LABELS,
  cardTone,
  errorRate,
  type HubCard,
  type HubTone,
} from "@/lib/admin/integration-hub/model";
import { MessagingKeysSection } from "./messaging-keys-form";
import { IntegrationTestButton } from "./integration-test-button";

/**
 * ENTEGRASYON MERKEZİ (Admin > Sistem > Entegrasyonlar, `?sekme=entegrasyonlar`). Platform entegrasyonlarının tek ekranı:
 * kart başına yapılandırma durumu, son başarılı/başarısız çağrı, 7 günlük hata oranı, kota/maliyet, "Test et" ve anahtarın
 * girildiği yer. Altında anahtar formları (OpenAI, portal API, SMS/WhatsApp; eskiden sağlık sekmesindeydi), ofislerin bağlı
 * entegrasyonları, API anahtarları ve webhook teslim günlüğü (salt okunur). Sırlar YALNIZ parmak iziyle görünür.
 */

const TONE_PILL: Record<HubTone, string> = {
  ok: "bg-mint-500/12 text-mint-600",
  warn: "bg-amber-400/15 text-amber-700",
  danger: "bg-danger-500/10 text-danger-500",
  off: "bg-ink-950/8 text-text-muted",
};

function TonePill({ tone }: { tone: HubTone }) {
  const Icon = tone === "ok" ? CheckCircle2 : tone === "off" ? CircleOff : tone === "warn" ? AlertTriangle : XCircle;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${TONE_PILL[tone]}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden /> {TONE_LABELS[tone]}
    </span>
  );
}

const OFFICE_STATUS: Record<string, { label: string; tone: HubTone }> = {
  healthy: { label: "Sağlıklı", tone: "ok" },
  configured: { label: "Yapılandırıldı", tone: "ok" },
  active: { label: "Etkin", tone: "ok" },
  degraded: { label: "Sorunlu", tone: "danger" },
  error: { label: "Hatalı", tone: "danger" },
  disabled: { label: "Kapalı", tone: "off" },
};

const PROVIDER_LABEL: Record<string, string> = { whatsapp: "WhatsApp Business", netgsm: "Netgsm SMS", resend: "E-posta" };

const auditHref = (action: string) => `/admin/aktivite?kaynak=platform&islem=${encodeURIComponent(action)}`;

function IntegrationCard({ card }: { card: HubCard }) {
  const tone = cardTone(card);
  const rate = errorRate(card.stats);
  const { meta } = card;
  return (
    <section id={`entegrasyon-${card.key}`} className="flex scroll-mt-24 flex-col gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-text-muted">{HUB_CATEGORY_LABELS[meta.category]}</p>
          <h3 className="truncate font-display font-bold text-ink-950">{meta.label}</h3>
          <p className="mt-0.5 text-xs text-text-muted">{meta.description}</p>
        </div>
        <TonePill tone={tone} />
      </div>

      {card.alarm ? <p className="rounded-[var(--radius-control)] bg-danger-500/[0.06] px-2.5 py-1.5 text-xs font-semibold text-danger-600">{card.alarm}</p> : null}

      {!card.configured ? (
        <p className="text-xs text-text-muted">
          <strong className="text-ink-950">Yapılandırılmadı.</strong> Nereden girilir:{" "}
          {meta.configureHref ? (
            <Link href={meta.configureHref} className="font-semibold text-brand-600 hover:underline">
              {meta.configureLabel}
            </Link>
          ) : (
            <span className="font-semibold text-ink-950">{meta.configureLabel}</span>
          )}
        </p>
      ) : null}

      <ul className="space-y-0.5 text-xs text-text-muted">
        {card.notes.map((n) => (
          <li key={n} className="truncate">
            {n}
          </li>
        ))}
      </ul>

      {card.fingerprints.length ? (
        <ul className="space-y-0.5" aria-label="Anahtar parmak izleri">
          {card.fingerprints.map((f) => (
            <li key={f.label} className="flex min-w-0 items-center gap-1.5 text-xs text-text-muted">
              <Fingerprint className="h-3.5 w-3.5 shrink-0 text-text-faint" aria-hidden />
              <span className="shrink-0">{f.label}:</span>
              <code className="numeric truncate text-ink-950">{f.value}</code>
            </li>
          ))}
        </ul>
      ) : null}

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-text-muted">Son başarılı</dt>
        <dd className="m-0 text-right font-semibold text-ink-950">{card.lastOkAt ? relativeTimeTR(card.lastOkAt) : "kayıt yok"}</dd>
        <dt className="text-text-muted">Son başarısız</dt>
        <dd className={`m-0 text-right font-semibold ${card.lastFailAt ? "text-danger-600" : "text-ink-950"}`}>{card.lastFailAt ? relativeTimeTR(card.lastFailAt) : "kayıt yok"}</dd>
        {card.stats ? (
          <>
            <dt className="text-text-muted">7 gün</dt>
            <dd className="m-0 text-right">
              <Link href={card.stats.href} className="font-semibold tabular-nums text-ink-950 hover:underline" title={`Sayılan: ${card.stats.source}`}>
                {card.stats.ok} başarılı · {card.stats.fail} hata{rate !== null ? ` (%${rate.toLocaleString("tr-TR")})` : ""}
              </Link>
            </dd>
          </>
        ) : null}
      </dl>
      {card.stats ? <p className="-mt-2 text-xs text-text-faint">Sayılan: {card.stats.source}</p> : null}

      {card.usage ? (
        <Link href={card.usage.href} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline">
          {card.usage.text} <ArrowUpRight className="h-3 w-3" aria-hidden />
        </Link>
      ) : null}

      <div className="mt-auto flex flex-wrap items-start justify-between gap-2 border-t border-line pt-3">
        <div className="min-w-0 text-xs text-text-muted">
          {card.lastTest ? (
            <Link href={auditHref(card.lastTest.action)} className="hover:underline">
              Son test {relativeTimeTR(card.lastTest.at)}:{" "}
              <span className={`font-semibold ${card.lastTest.ok ? "text-mint-700" : "text-danger-600"}`}>{card.lastTest.ok ? "başarılı" : "başarısız"}</span>
              {card.lastTest.message ? <span className="block truncate text-text-faint">{card.lastTest.message}</span> : null}
            </Link>
          ) : (
            <span>Henüz test edilmedi</span>
          )}
        </div>
        {meta.testNote ? (
          <div className="flex flex-col items-end gap-0.5">
            <IntegrationTestButton integration={card.key} label={meta.label} />
            <span className="text-xs text-text-faint">{meta.testNote}</span>
          </div>
        ) : (
          <span className="text-xs text-text-faint">Zararsız test uç noktası yok</span>
        )}
      </div>
    </section>
  );
}

function OfficeTable({ rows }: { rows: OfficeIntegrationRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-xs">
        <thead className="text-text-muted">
          <tr className="border-b border-line">
            <th className="px-4 py-2 font-semibold">Ofis</th>
            <th className="px-4 py-2 font-semibold">Entegrasyon</th>
            <th className="px-4 py-2 font-semibold">Durum</th>
            <th className="px-4 py-2 font-semibold">Son denetim</th>
            <th className="px-4 py-2 font-semibold">Son hata</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => {
            const st = r.active ? (OFFICE_STATUS[r.status] ?? { label: r.status, tone: "warn" as HubTone }) : OFFICE_STATUS.disabled;
            return (
              <tr key={r.id}>
                <td className="px-4 py-2">
                  <Link href={`/admin/tenants/${r.tenantId}`} className="font-semibold text-ink-950 hover:underline">
                    {r.tenantName}
                  </Link>
                </td>
                <td className="px-4 py-2 text-ink-950">{PROVIDER_LABEL[r.provider] ?? r.provider}</td>
                <td className="px-4 py-2">
                  <span className={`inline-flex rounded-full px-2 py-0.5 font-bold ${TONE_PILL[st.tone]}`}>{st.label}</span>
                </td>
                <td className="px-4 py-2 text-text-muted">{r.lastCheckedAt ? relativeTimeTR(r.lastCheckedAt) : "—"}</td>
                <td className="max-w-[260px] truncate px-4 py-2 text-text-muted" title={r.lastError ?? undefined}>
                  {r.lastError ?? "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Panel({ id, icon: Icon, eyebrow, title, children }: { id: string; icon: typeof Webhook; eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
      <div className="border-b border-line px-5 py-3.5">
        <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
          <Icon className="h-4 w-4" aria-hidden /> {eyebrow}
        </p>
        <h2 className="mt-1 font-display font-bold text-ink-950">{title}</h2>
      </div>
      {children}
    </section>
  );
}

export async function IntegrationsView() {
  const staff = await requirePlatformModule("sistem");
  const hub = await loadIntegrationHub();
  const canEdit = staff.role === "super_admin";

  const tones = hub.cards.map(cardTone);
  const configured = hub.cards.filter((c) => c.configured).length;
  const problems = tones.filter((t) => t === "danger" || t === "warn").length;
  const officeRows = [...hub.offices.rows, ...hub.offices.einvoice];
  const officeActive = officeRows.filter((r) => r.active).length;
  const officeDegraded = officeRows.filter((r) => r.active && r.status === "degraded").length;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="Sistem"
        icon={PlugZap}
        title="Entegrasyon merkezi"
        description="Ödeme, SMS, e-posta, WhatsApp, Google, yapay zeka, veri ve portal bağlantılarının canlı durumu. Anahtarlar yalnız parmak iziyle görünür; “Test et” zararsız bir çağrı yapar ve sonucu denetim kaydına yazar."
      >
        <KpiGrid label="Entegrasyon göstergeleri" className="lg:grid-cols-4 2xl:grid-cols-4">
          <KpiCard layout="inline" label="Yapılandırılmış" value={`${configured}/${hub.cards.length}`} href="#kartlar" icon={PlugZap} tone={configured === hub.cards.length ? "success" : "brand"} hint="platform entegrasyonu" />
          <KpiCard layout="inline" label="Sorunlu" value={problems} href="#kartlar" icon={AlertTriangle} tone={problems > 0 ? "danger" : "success"} attention={problems > 0} hint="alarm, hata veya başarısız test" />
          <KpiCard
            layout="inline"
            label="Ofis bağlantısı"
            value={officeActive}
            href="#ofis-baglantilari"
            icon={Building2}
            tone={officeDegraded > 0 ? "warn" : "brand"}
            attention={officeDegraded > 0}
            hint={officeDegraded > 0 ? `${officeDegraded} sorunlu` : "etkin bağlantı"}
          />
          <KpiCard
            layout="inline"
            label="Webhook hatası"
            value={hub.webhooks.failed}
            href="#webhook-gunlugu"
            icon={Webhook}
            tone={hub.webhooks.failed > 0 ? "danger" : "success"}
            attention={hub.webhooks.failed > 0}
            hint="son 7 gün, başarısız teslim"
          />
        </KpiGrid>
      </AdminPageHeader>

      <div id="kartlar" className="grid scroll-mt-24 gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {hub.cards.map((c) => (
          <IntegrationCard key={c.key} card={c} />
        ))}
      </div>

      {/* Anahtar formları: değerler şifreli (sealSecret) yazılır; ekranda yalnız parmak izi. Yazma yalnız süper admin. */}
      <div id="anahtar-openai" className="scroll-mt-24">
        <OpenAiKeyForm configured={hub.forms.openai.configured} source={hub.forms.openai.source} masked={hub.forms.openai.fingerprint} canEdit={canEdit} />
      </div>
      <div id="anahtar-portal" className="scroll-mt-24">
        <PortalApiKeysSection
          canEdit={canEdit}
          sahibindenConfigured={hub.forms.portals.sahibinden.configured}
          hepsiemlakConfigured={hub.forms.portals.hepsiemlak.configured}
          emlakjetConfigured={hub.forms.portals.emlakjet.configured}
          maskedSahibinden={hub.forms.portals.sahibinden.fingerprint}
          maskedHepsiemlak={hub.forms.portals.hepsiemlak.fingerprint}
          maskedEmlakjet={hub.forms.portals.emlakjet.fingerprint}
        />
      </div>
      <div id="anahtar-mesaj" className="scroll-mt-24">
        <MessagingKeysSection
          canEdit={canEdit}
          netgsmConfigured={hub.forms.messaging.netgsmConfigured}
          netgsmSummary={hub.forms.messaging.netgsmSummary}
          whatsappConfigured={hub.forms.messaging.whatsappConfigured}
          whatsappSummary={hub.forms.messaging.whatsappSummary}
        />
      </div>

      <Panel id="ofis-baglantilari" icon={Building2} eyebrow="Ofis başına" title={`Ofislerin bağlı entegrasyonları (${officeRows.length})`}>
        {officeRows.length ? (
          <OfficeTable rows={officeRows} />
        ) : (
          <p className="px-5 py-4 text-sm text-text-muted">
            {hub.offices.available ? "Henüz hiçbir ofis kendi entegrasyonunu (WhatsApp Business, Netgsm, e-Fatura) bağlamadı." : "Ofis entegrasyon kayıtları okunamadı."}
          </p>
        )}
      </Panel>

      <Panel id="api-anahtarlari" icon={KeyRound} eyebrow="Ofis API'si" title={`Etkin API anahtarları (${hub.apiKeys.active})`}>
        {hub.apiKeys.rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="text-text-muted">
                <tr className="border-b border-line">
                  <th className="px-4 py-2 font-semibold">Ofis</th>
                  <th className="px-4 py-2 font-semibold">Ad</th>
                  <th className="px-4 py-2 font-semibold">Önek</th>
                  <th className="px-4 py-2 font-semibold">Kapsam</th>
                  <th className="px-4 py-2 font-semibold">Son kullanım</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {hub.apiKeys.rows.map((k) => (
                  <tr key={k.id}>
                    <td className="px-4 py-2">
                      <Link href={`/admin/tenants/${k.tenantId}`} className="font-semibold text-ink-950 hover:underline">
                        {k.tenantName}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-ink-950">{k.name}</td>
                    <td className="numeric px-4 py-2 text-text-muted">{k.prefix}…</td>
                    <td className="px-4 py-2 text-text-muted">{k.scopes.join(", ")}</td>
                    <td className="px-4 py-2 text-text-muted">{k.lastUsedAt ? relativeTimeTR(k.lastUsedAt) : "hiç"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-5 py-4 text-sm text-text-muted">{hub.apiKeys.available ? "Etkin API anahtarı yok." : "API anahtarı kayıtları okunamadı."}</p>
        )}
        <p className="border-t border-line px-5 py-3 text-xs text-text-faint">Anahtarın kendisi saklanmaz (yalnız özeti); önek yalnız tanımlayıcıdır. Anahtarı ofis kendi Ayarlar ekranından iptal eder.</p>
      </Panel>

      <Panel id="webhook-gunlugu" icon={Webhook} eyebrow="Ofis webhook'ları" title="Webhook teslim günlüğü">
        <dl className="grid grid-cols-2 gap-3 border-b border-line px-5 py-3 text-xs sm:grid-cols-4">
          {[
            { label: "Teslim edildi (7 gün)", value: hub.webhooks.delivered, tone: "text-mint-700" },
            { label: "Başarısız (7 gün)", value: hub.webhooks.failed, tone: hub.webhooks.failed ? "text-danger-600" : "text-ink-950" },
            { label: "Kuyrukta", value: hub.webhooks.pending, tone: "text-ink-950" },
            { label: "Hata veren uç", value: hub.webhooks.failingEndpoints, tone: hub.webhooks.failingEndpoints ? "text-amber-700" : "text-ink-950" },
          ].map((s) => (
            <a key={s.label} href="#webhook-satirlari" className="rounded-[var(--radius-control)] px-2 py-1 hover:bg-surface-hover">
              <dt className="text-text-muted">{s.label}</dt>
              <dd className={`m-0 text-lg font-bold tabular-nums ${s.tone}`}>{s.value}</dd>
            </a>
          ))}
        </dl>
        {hub.webhooks.rows.length ? (
          <div id="webhook-satirlari" className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="text-text-muted">
                <tr className="border-b border-line">
                  <th className="px-4 py-2 font-semibold">Ofis</th>
                  <th className="px-4 py-2 font-semibold">Uç (host)</th>
                  <th className="px-4 py-2 font-semibold">Olay</th>
                  <th className="px-4 py-2 font-semibold">Durum</th>
                  <th className="px-4 py-2 font-semibold">Deneme</th>
                  <th className="px-4 py-2 font-semibold">Son yanıt</th>
                  <th className="px-4 py-2 font-semibold">Zaman</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {hub.webhooks.rows.map((d) => (
                  <tr key={d.id}>
                    <td className="px-4 py-2">
                      <Link href={`/admin/tenants/${d.tenantId}`} className="font-semibold text-ink-950 hover:underline">
                        {d.tenantName}
                      </Link>
                    </td>
                    <td className="numeric px-4 py-2 text-text-muted">{d.endpointHost}</td>
                    <td className="numeric px-4 py-2 text-ink-950">{d.event}</td>
                    <td className="px-4 py-2">
                      <span className={`inline-flex rounded-full px-2 py-0.5 font-bold ${d.status === "failed" ? TONE_PILL.danger : TONE_PILL.warn}`}>
                        {d.status === "failed" ? "Başarısız" : "Bekliyor"}
                      </span>
                    </td>
                    <td className="px-4 py-2 tabular-nums text-text-muted">{d.attempts}</td>
                    <td className="max-w-[220px] truncate px-4 py-2 text-text-muted" title={d.lastError ?? undefined}>
                      {d.lastStatusCode ? `HTTP ${d.lastStatusCode}` : ""}
                      {d.lastError ? `${d.lastStatusCode ? " · " : ""}${d.lastError}` : d.lastStatusCode ? "" : "—"}
                    </td>
                    <td className="px-4 py-2 text-text-muted">{relativeTimeTR(d.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p id="webhook-satirlari" className="px-5 py-4 text-sm text-text-muted">
            {hub.webhooks.available ? "Başarısız ya da bekleyen teslim yok." : "Webhook teslim kayıtları okunamadı."}
          </p>
        )}
        <p className="border-t border-line px-5 py-3 text-xs text-text-faint">
          Uç adresinin yalnız host kısmı gösterilir (yol ve sorgu belirteç taşıyabilir). Teslim gövdesi bu ekrana getirilmez.
        </p>
      </Panel>

      <p className="text-xs text-text-faint">
        Test kayıtları{" "}
        <Link href="/admin/aktivite?kaynak=platform&islem=integration." className="font-semibold text-brand-600 hover:underline">
          Aktivite kaydında
        </Link>{" "}
        tutulur (eylem: integration.&lt;ad&gt;.test).
      </p>
    </div>
  );
}
