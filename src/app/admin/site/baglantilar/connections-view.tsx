import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, LifeBuoy, PlugZap } from "lucide-react";
import Link from "@/components/ui/smart-link";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toTrLocalInput } from "@/lib/clock";
import { GOOGLE_DOCS, GOOGLE_REDIRECT_URI, helpRequestHref } from "@/lib/google/keys";
import { SERVICE_STATUS_TONE } from "@/lib/google/status";
import { serviceCard, type ConnectionView, type ServiceCard } from "@/lib/google/view-model";
import { AdsAccountForm, ClientForm, ConnectButton, DisconnectButton, DocLink, GscPropertyPicker, TestAdsButton } from "./connect-forms";

/**
 * Bağlantılar ve kurulum ekranı (sunucu bileşeni, yalnız görünüm modeli alır; Google API çağrılmaz).
 * Bağlı değilken TAM çalışır: kartlar dürüst "Bağlı değil" gösterir, sihirbaz adım adım kurdurur.
 */

const TONE: Record<"info" | "ok" | "danger" | "warn", string> = {
  info: "bg-brand-600/10 text-brand-700",
  ok: "bg-mint-500/15 text-mint-700",
  danger: "bg-danger-500/10 text-danger-700",
  warn: "bg-amber-100 text-amber-900",
};

export const ADS_HONESTY_SENTENCE = "Reklam bütçesi ve teklif değişiklikleri bu sürümde Google Ads içinden yapılır; burada öneri görürsünüz.";

const fmt = (iso: string | null) => (iso ? toTrLocalInput(iso).replace("T", " ") : "—");

function StatusChip({ card }: { card: ServiceCard }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${TONE[SERVICE_STATUS_TONE[card.status]]}`}>
      {card.status === "yeniden_bagla" ? <AlertTriangle className="h-3 w-3" aria-hidden /> : null}
      {card.statusLabel}
    </span>
  );
}

function HelpLink({ step }: { step: string }) {
  return (
    <a href={helpRequestHref(step)} className="inline-flex items-center gap-1 text-xs font-semibold text-text-muted hover:text-brand-700 hover:underline">
      <LifeBuoy className="h-3.5 w-3.5" aria-hidden /> Bunu ekibimiz yapsın
    </a>
  );
}

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: ReactNode }) {
  return (
    <li className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-bold text-ink-950">
          <span
            className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${done ? "bg-mint-500/20 text-mint-700" : "bg-brand-600/10 text-brand-700"}`}
            aria-hidden
          >
            {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : n}
          </span>
          {n}. {title}
          {done ? <span className="sr-only">(tamamlandı)</span> : null}
        </h3>
        <HelpLink step={`${n}. ${title}`} />
      </div>
      <div className="mt-3 space-y-3 text-sm text-text-muted">{children}</div>
    </li>
  );
}

export function ConnectionsView({ view, canWrite, flash }: { view: ConnectionView & { readError?: boolean }; canWrite: boolean; flash?: { ok?: string; error?: string } }) {
  const gsc = serviceCard(view, "gsc");
  const ads = serviceCard(view, "ads");
  const gscLinked = gsc.connectedAt !== null;
  const adsLinked = ads.connectedAt !== null;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="Site, SEO ve Reklam"
        icon={PlugZap}
        title="Bağlantılar ve kurulum"
        description="Search Console ve Google Ads'i bir kez bağlayın; veriler her gece kendiliğinden gelir. Bağlanana kadar hiçbir Google çağrısı yapılmaz."
        art="pulse"
      />

      {flash?.ok ? (
        <p role="status" className="flex items-center gap-1.5 rounded-[var(--radius-control)] bg-mint-500/10 px-3 py-2 text-sm font-medium text-mint-700">
          <CheckCircle2 className="h-4 w-4" aria-hidden /> {flash.ok}
        </p>
      ) : null}
      {flash?.error ? (
        <p role="alert" className="rounded-[var(--radius-control)] bg-danger-500/8 px-3 py-2 text-sm font-medium text-danger-600">
          {flash.error}
        </p>
      ) : null}

      <p className="flex items-start gap-2 rounded-[var(--radius-control)] bg-brand-600/8 px-3 py-2 text-sm text-ink-950">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" aria-hidden />
        {ADS_HONESTY_SENTENCE}
      </p>

      {!canWrite ? (
        <p role="status" className="rounded-[var(--radius-control)] bg-surface-hover px-3 py-2 text-sm text-text-muted">
          Salt okunur görünüm: bağlama, kesme ve gizli değer girişi yalnız süper admin içindir.
        </p>
      ) : null}
      {!view.secretsEnabled ? (
        <p role="alert" className="rounded-[var(--radius-control)] bg-amber-100 px-3 py-2 text-sm font-medium text-amber-900">
          Şifreleme anahtarı tanımlı değil: Google bilgileri düz metin olarak saklanmadığı için bağlantı kurulamaz.
        </p>
      ) : null}
      {view.readError ? (
        <p role="alert" className="rounded-[var(--radius-control)] bg-amber-100 px-3 py-2 text-sm font-medium text-amber-900">
          Bağlantı kayıtları şu an okunamadı; durum &quot;Bağlı değil&quot; görünebilir. Sayfayı yenileyin.
        </p>
      ) : null}
      {view.problems.length > 0 ? (
        <p role="alert" className="rounded-[var(--radius-control)] bg-danger-500/8 px-3 py-2 text-sm font-medium text-danger-600">
          Bazı kayıtlar açılamadı ya da şifresiz bulundu ({view.problems.join(", ")}); güvenlik için kullanılmıyor. İlgili adımı yeniden kaydedin.
        </p>
      ) : null}

      <section aria-label="Hizmet durumları" className="grid gap-4 md:grid-cols-2">
        {[gsc, ads].map((card) => (
          <Card key={card.service}>
            <CardHeader>
              <div className="flex w-full flex-wrap items-center justify-between gap-2">
                <CardTitle>{card.label}</CardTitle>
                <StatusChip card={card} />
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt className="text-text-muted">Son senkron</dt>
                <dd className="font-medium text-ink-950">{fmt(card.lastSyncAt)}</dd>
                <dt className="text-text-muted">Bağlandı</dt>
                <dd className="font-medium text-ink-950">{fmt(card.connectedAt)}</dd>
                {card.details.map((d) => (
                  <FragmentRow key={d.label} label={d.label} value={d.value} />
                ))}
              </dl>
              {card.lastError ? <p className="text-xs text-danger-600">Son hata: {card.lastError}</p> : null}
              {card.status === "kota" ? <p className="text-xs text-amber-900">Bugünkü Google kotasının %80&apos;ine gelindi; yarın kendiliğinden sürer.</p> : null}
              <p className="text-xs">
                <Link
                  href={card.service === "gsc" ? "/admin/seo/performans" : "/admin/site/reklam/google"}
                  className="font-semibold text-brand-700 hover:underline"
                >
                  {card.service === "gsc" ? "Arama performansını aç" : "Reklam panosunu aç"}
                </Link>
              </p>
              {canWrite && card.connectedAt ? <DisconnectButton service={card.service} label={card.label} /> : null}
            </CardContent>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Kurulum sihirbazı</CardTitle>
            <CardDescription>Beş adım. Her adımda &quot;Bunu ekibimiz yapsın&quot; ile destek isteyebilirsiniz.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3">
            <Step n={1} title="Google Cloud projesi ve OAuth istemcisi" done={view.client.configured}>
              <p>
                Google Cloud konsolunda bir proje açın, &quot;Web uygulaması&quot; türünde OAuth istemcisi oluşturun ve yetkili yönlendirme adresi olarak
                tam olarak şunu ekleyin: <code className="break-all rounded bg-surface-hover px-1 font-mono text-xs text-ink-950">{GOOGLE_REDIRECT_URI}</code>
              </p>
              <p className="rounded-[var(--radius-control)] bg-amber-100 px-3 py-2 text-amber-900">
                Workspace hesabınız varsa onay ekranını <strong>Internal</strong> seçin. Yoksa uygulama Google doğrulaması gerektirir; <strong>Testing</strong>{" "}
                kipinde verilen izin 7 günde ölür ve bağlantı &quot;Yeniden bağla&quot;ya düşer.
              </p>
              <p className="flex flex-wrap gap-x-4 gap-y-1">
                <DocLink href={GOOGLE_DOCS.oauthClient}>OAuth istemcisi (resmî belge)</DocLink>
                <DocLink href={GOOGLE_DOCS.consentScreen}>Onay ekranı (resmî belge)</DocLink>
              </p>
            </Step>
            <Step n={2} title="İstemci kimliğini girin" done={view.client.configured}>
              {view.client.configured ? <p>Kayıtlı istemci: <span className="font-mono">{view.client.clientIdMasked}</span></p> : <p>Henüz istemci girilmedi.</p>}
              {canWrite && view.secretsEnabled ? <ClientForm configured={view.client.configured} /> : null}
            </Step>
            <Step n={3} title="Search Console'u bağlayın ve mülkü seçin" done={gscLinked && Boolean(view.gscProperty)}>
              <p>
                Yalnız okuma izni istenir (<span className="font-mono">webmasters.readonly</span>). Alan (Domain) mülkü önerilir: tüm alt adresleri ve
                http/https sürümlerini birlikte sayar. <DocLink href={GOOGLE_DOCS.searchConsole}>Mülk ekleme</DocLink>
              </p>
              {view.gscProperty ? <p>Seçili mülk: <span className="font-mono">{view.gscProperty}</span></p> : null}
              {canWrite && view.secretsEnabled && view.client.configured ? (
                <div className="space-y-3">
                  {!gscLinked || gsc.status === "yeniden_bagla" ? <ConnectButton service="gsc" label="Search Console" reconnect={gsc.status === "yeniden_bagla"} /> : null}
                  {gscLinked && gsc.status !== "yeniden_bagla" ? <GscPropertyPicker current={view.gscProperty} /> : null}
                </div>
              ) : null}
            </Step>
            <Step n={4} title="Ads müşteri kimliği, MCC ve developer token" done={Boolean(view.ads)}>
              <p>
                Developer token Google Ads → Araçlar → API Merkezi&apos;nden alınır. <strong>Basic erişim başvurusu günler sürebilir</strong>; onaya kadar
                yalnız test hesapları okunabilir. <DocLink href={GOOGLE_DOCS.adsDeveloperToken}>Developer token</DocLink>{" "}
                <DocLink href={GOOGLE_DOCS.adsAccessLevels}>Erişim düzeyleri</DocLink>
              </p>
              {view.ads ? (
                <p>
                  Kayıtlı: müşteri <span className="font-mono">{view.ads.customerIdMasked}</span>
                  {view.ads.mccMasked ? (
                    <>
                      {" "}· MCC <span className="font-mono">{view.ads.mccMasked}</span>
                    </>
                  ) : null}{" "}
                  · token {view.ads.tokenConfigured ? "kayıtlı (şifreli)" : "yok"} · API {view.ads.apiVersion}
                </p>
              ) : null}
              {canWrite && view.secretsEnabled ? <AdsAccountForm configured={Boolean(view.ads)} apiVersion={view.ads?.apiVersion ?? "v22"} /> : null}
            </Step>
            <Step n={5} title="Ads'i bağlayın" done={adsLinked && ads.status !== "yeniden_bagla"}>
              <p>Reklam hesabı yalnız OKUNUR: kampanya ve reklam grubu metrikleri her gece bir sorguyla çekilir. Hesapta hiçbir değişiklik yapılmaz.</p>
              {canWrite && view.secretsEnabled && view.client.configured && view.ads ? (
                <div className="space-y-3">
                  {!adsLinked || ads.status === "yeniden_bagla" ? <ConnectButton service="ads" label="Google Ads" reconnect={ads.status === "yeniden_bagla"} /> : <TestAdsButton />}
                </div>
              ) : null}
            </Step>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

function FragmentRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-text-muted">{label}</dt>
      <dd className="break-all font-medium text-ink-950">{value}</dd>
    </>
  );
}
