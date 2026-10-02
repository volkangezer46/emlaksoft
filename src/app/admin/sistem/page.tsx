import Link from "next/link";
import { ArrowUpRight, Bug, CheckCircle2, Clock3, Database, HeartPulse, KeyRound, Landmark, Layers, MapPin, MapPinned, Radar, XCircle } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminStatCard, AdminStatGrid } from "@/components/admin/admin-stat-card";
import { probeSchema } from "./schema-checks";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { getPlatformSetting } from "@/lib/platform-settings";
import { relativeTimeTR } from "@/lib/admin-format";
import { msSince } from "@/lib/clock";
import { CRON_JOBS } from "@/lib/cron-jobs";
import { OpenAiKeyForm } from "@/components/admin/openai-key-form";
import { EndeksaKeyForm, TapusorKeyForm } from "@/components/admin/integration-keys-form";
import { PortalApiKeysSection } from "@/components/admin/portal-keys-form";
import { getPortalConfig } from "@/lib/integrations/portals";

const TOTAL_PROVINCES = 81;

type Heartbeat = { job: string; last_run_at: string; last_status: string; last_detail: string | null };

function StatusPill({ ok, okLabel, badLabel }: { ok: boolean; okLabel: string; badLabel: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${
        ok ? "bg-mint-500/12 text-mint-600" : "bg-danger-500/10 text-danger-500"
      }`}
    >
      {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
      {ok ? okLabel : badLabel}
    </span>
  );
}

function mask(value: string | null, prefixLen = 6, suffixLen = 4): string | null {
  if (!value) return null;
  if (value.length <= prefixLen + suffixLen) return `${value.slice(0, 3)}••••`;
  return `${value.slice(0, prefixLen)}••••••••${value.slice(-suffixLen)}`;
}

export default async function AdminSystemPage() {
  const staff = await requirePlatformModule("sistem");
  const admin = createAdminClient();

  // Tüm platform ayarları + geo sayımları tek turda (bağımsız → tam paralel)
  const [
    dbKey,
    dbEndeksaId, dbEndeksaSecret, dbTapusorKey,
    sahibindenConfig, hepsiemlakConfig, zingatConfig, emlakjetConfig,
    { count: provinces }, { count: districts }, { count: neighborhoods },
    { data: heartbeatRows },
    schemaRows,
    { count: openErrors },
  ] = await Promise.all([
    getPlatformSetting("openai_api_key"),
    getPlatformSetting("endeksa_client_id"),
    getPlatformSetting("endeksa_client_secret"),
    getPlatformSetting("tapusor_api_key"),
    getPortalConfig("sahibinden"),
    getPortalConfig("hepsiemlak"),
    getPortalConfig("zingat"),
    getPortalConfig("emlakjet"),
    admin.from("geo_provinces").select("id", { count: "exact", head: true }),
    admin.from("geo_districts").select("id", { count: "exact", head: true }),
    admin.from("geo_neighborhoods").select("id", { count: "exact", head: true }),
    admin.from("cron_heartbeats").select("job, last_run_at, last_status, last_detail"),
    probeSchema(),
    admin.from("error_logs").select("id", { count: "exact", head: true }).is("resolved_at", null),
  ]);

  const heartbeats = new Map<string, Heartbeat>();
  for (const h of (heartbeatRows ?? []) as Heartbeat[]) heartbeats.set(h.job, h);

  // Cron sağlığı özeti — hero kartlarında gösterilir
  const cronHealthy = CRON_JOBS.filter(({ job, staleAfterMinutes }) => {
    const hb = heartbeats.get(job);
    return hb && hb.last_status !== "error" && msSince(hb.last_run_at) <= staleAfterMinutes * 60_000;
  }).length;
  const schemaMissing = schemaRows.filter((r) => !r.ok);

  // OpenAI
  const envKey = process.env.OPENAI_API_KEY?.trim() || null;
  const activeKey = (dbKey?.trim() || envKey) ?? null;
  const keySource: "db" | "env" | "none" = dbKey?.trim() ? "db" : envKey ? "env" : "none";
  const maskedKey = activeKey ? mask(activeKey) : null;

  // Endeksa — DB öncelikli
  const endeksaClientId = dbEndeksaId?.trim() || process.env.ENDEKSA_CLIENT_ID?.trim() || null;
  const endeksaSecret = dbEndeksaSecret?.trim() || process.env.ENDEKSA_CLIENT_SECRET?.trim() || null;
  const tapusorApiKey = dbTapusorKey?.trim() || process.env.TAPUSOR_API_KEY?.trim() || null;

  const endeksaConfigured = Boolean(endeksaClientId && endeksaSecret);
  const tapusorConfigured = Boolean(tapusorApiKey);

  // Portal API anahtarları
  const sahibindenKey  = sahibindenConfig?.apiKey ?? null;
  const hepsiemlakKey  = hepsiemlakConfig?.apiKey ?? null;
  const zingatKey      = zingatConfig?.apiKey ?? null;
  const emlakjetKey    = emlakjetConfig?.apiKey ?? null;

  const maskedSahibinden  = sahibindenKey  ? mask(sahibindenKey)  : null;
  const maskedHepsiemlak  = hepsiemlakKey  ? mask(hepsiemlakKey)  : null;
  const maskedZingat      = zingatKey      ? mask(zingatKey)      : null;
  const maskedEmlakjet    = emlakjetKey    ? mask(emlakjetKey)    : null;

  // Endeksa/Tapusor masked değerler (güvenli gösterim)
  const maskedEndeksaId = endeksaClientId ? mask(endeksaClientId, 4, 3) : null;
  const maskedTapusorKey = tapusorApiKey ? mask(tapusorApiKey) : null;

  const provinceCoverage = Math.round(((provinces ?? 0) / TOTAL_PROVINCES) * 100);
  const cronConfigured = Boolean(process.env.CRON_SECRET?.trim());
  const pushConfigured = Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
  const iyzicoConfigured = Boolean(process.env.IYZICO_API_KEY && process.env.IYZICO_SECRET_KEY);

  return (
    <div className="space-y-6">
      {/* Hero */}
      <AdminPageHeader
        eyebrow="Sistem sağlığı"
        icon={Radar}
        title="Altyapı & entegrasyon durumu"
        description="Geo kapsama, cron güvenliği, şema sürümü ve opsiyonel entegrasyonların (iyzico, Endeksa, Tapusor, yapay zeka) canlı yapılandırma durumu."
      >
        <AdminStatGrid className="mt-6">
          <AdminStatCard
            tone="dark"
            label="Sağlıklı cron"
            value={`${cronHealthy}/${CRON_JOBS.length}`}
            icon={HeartPulse}
            accent={cronHealthy === CRON_JOBS.length ? "text-mint-400" : "text-amber-300"}
            hint="iş zamanlamasına göre sağlıklı"
          />
          <AdminStatCard
            tone="dark"
            label="Şema durumu"
            value={schemaMissing.length === 0 ? "Güncel" : `${schemaMissing.length} eksik`}
            icon={Layers}
            accent={schemaMissing.length === 0 ? "text-mint-400" : "text-danger-300"}
            hint={`${schemaRows.length} kontrol noktası`}
          />
          <AdminStatCard
            tone="dark"
            label="Açık hata türü"
            value={openErrors ?? 0}
            href="/admin/hatalar"
            icon={Bug}
            accent={(openErrors ?? 0) > 0 ? "text-danger-300" : "text-mint-400"}
            hint="tekilleştirilmiş üretim hatası"
          />
          <AdminStatCard
            tone="dark"
            label="Geo kapsama"
            value={`%${provinceCoverage}`}
            href="/admin/geo"
            icon={MapPin}
            accent="text-cyan-300"
            hint={`${provinces ?? 0}/${TOTAL_PROVINCES} il`}
          />
        </AdminStatGrid>
      </AdminPageHeader>

      {/* Geo + ortam değişkenleri */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
          <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
            <MapPin className="h-4 w-4" /> Geo kapsama (D3)
          </p>
          <h2 className="mt-1 font-display font-bold text-ink-950">İl / ilçe / mahalle</h2>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="rounded-[var(--radius-card)] border border-line bg-canvas/60 p-3 text-center">
              <p className="font-display text-xl font-extrabold text-ink-950">{provinces ?? 0}/{TOTAL_PROVINCES}</p>
              <p className="text-xs text-text-muted">İl (%{provinceCoverage})</p>
            </div>
            <div className="rounded-[var(--radius-card)] border border-line bg-canvas/60 p-3 text-center">
              <p className="font-display text-xl font-extrabold text-ink-950">{(districts ?? 0).toLocaleString("tr-TR")}</p>
              <p className="text-xs text-text-muted">İlçe</p>
            </div>
            <div className="rounded-[var(--radius-card)] border border-line bg-canvas/60 p-3 text-center">
              <p className="font-display text-xl font-extrabold text-ink-950">{(neighborhoods ?? 0).toLocaleString("tr-TR")}</p>
              <p className="text-xs text-text-muted">Mahalle</p>
            </div>
          </div>
          <p className="mt-4 text-xs text-text-muted">
            Her il, coğrafya yönetiminden tek tıkla ayrı taranır. Seçilen il öne alınır; diğer il taramaları bekletilir ve eksikler atomik olarak tamamlanır.
          </p>
          <p className="mt-2 text-xs text-text-faint">
            Kaynak: TurkiyeAPI v2. Kaynakta bulunmayan yerel kayıtlar silinmez ve pasif kayıtlar otomatik yeniden açılmaz.
          </p>
          <Link
            href="/admin/geo"
            className="mt-4 inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line px-3 py-2 text-xs font-semibold text-brand-600 transition hover:border-brand-400"
          >
            Coğrafya yönetimine git <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </section>

        {/* Uretim hatalari: onceden yalnizca Vercel loglarinda vardi ve
            toplanmiyordu — ayni hata bir kez mi 400 kez mi olmus,
            gorunmuyordu. */}
        <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
          <p className="flex items-center gap-2 text-xs font-semibold text-danger-500">
            <Bug className="h-4 w-4" /> Üretim izleme
          </p>
          <h2 className="mt-1 font-display font-bold text-ink-950">Hata kayıtları</h2>
          <p className="mt-2 text-sm leading-relaxed text-text-muted">
            Tarayıcı hata sınırlarından gelen kayıtlar. Aynı hata tekrar geldiğinde yeni satır
            açılmaz, sayaç artar — kaç <strong>farklı</strong> sorun olduğu görünür.
          </p>
          <Link
            href="/admin/hatalar"
            className="mt-4 inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line px-3 py-2 text-xs font-semibold text-brand-600 transition hover:border-brand-400"
          >
            Hataları aç <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </section>

        {/* Cron sağlığı: her job son çalışmasında cron_heartbeats'e tek satır
            düşer. Gecikme eşiği işin gerçek Vercel zamanlamasına göre değişir. */}
        <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
          <p className="flex items-center gap-2 text-xs font-semibold text-mint-600">
            <HeartPulse className="h-4 w-4" /> Cron sağlığı
          </p>
          <h2 className="mt-1 font-display font-bold text-ink-950">Zamanlanmış görevler</h2>
          <div className="mt-4 space-y-2">
            {CRON_JOBS.map(({ job, label, cadenceLabel, staleAfterMinutes }) => {
              const hb = heartbeats.get(job);
              const stale = !hb || msSince(hb.last_run_at) > staleAfterMinutes * 60_000;
              const failed = hb?.last_status === "error";
              return (
                <div
                  key={job}
                  className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line bg-canvas/60 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink-950">{label}</p>
                    <p className="truncate text-xs text-text-faint">
                      <span className="numeric">{job}</span> · {cadenceLabel}
                      {hb ? ` · ${relativeTimeTR(hb.last_run_at)}` : " · hiç çalışmadı"}
                      {hb?.last_detail ? ` · ${hb.last_detail}` : ""}
                    </p>
                  </div>
                  {failed ? (
                    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-danger-500/10 px-2.5 py-1 text-xs font-bold text-danger-500">
                      <XCircle className="h-3.5 w-3.5" /> Hata
                    </span>
                  ) : stale ? (
                    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-400/15 px-2.5 py-1 text-xs font-bold text-amber-600">
                      <Clock3 className="h-3.5 w-3.5" /> Gecikmiş
                    </span>
                  ) : (
                    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-mint-500/12 px-2.5 py-1 text-xs font-bold text-mint-600">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Sağlıklı
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-text-faint">
            Her görev kendi çalışma sıklığına göre değerlendirilir. Kalp atışı yazılamazsa
            sunucu kaydı oluşur; zamanlanmış işin ana sonucu bloklanmaz.
          </p>
        </section>

        <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
          <p className="flex items-center gap-2 text-xs font-semibold text-amber-600">
            <KeyRound className="h-4 w-4" /> Altyapı &amp; güvenlik
          </p>
          <h2 className="mt-1 font-display font-bold text-ink-950">Ortam değişkenleri</h2>
          <div className="mt-4 space-y-2.5">
            <div className="flex items-center justify-between rounded-[var(--radius-card)] border border-line bg-canvas/60 px-3 py-2.5">
              <span className="text-sm font-semibold text-ink-950">CRON_SECRET</span>
              <StatusPill ok={cronConfigured} okLabel="Tanımlı" badLabel="Eksik" />
            </div>
            <div className="flex items-center justify-between rounded-[var(--radius-card)] border border-line bg-canvas/60 px-3 py-2.5">
              <span className="text-sm font-semibold text-ink-950">iyzico (canlı tahsilat)</span>
              <StatusPill ok={iyzicoConfigured} okLabel="Tanımlı" badLabel="Demo mod" />
            </div>
            <div className="flex items-center justify-between rounded-[var(--radius-card)] border border-line bg-canvas/60 px-3 py-2.5">
              <span className="text-sm font-semibold text-ink-950">VAPID push (bildirim)</span>
              <StatusPill ok={pushConfigured} okLabel="Tanımlı" badLabel="Kapalı" />
            </div>
            <div className="flex items-center justify-between rounded-[var(--radius-card)] border border-line bg-canvas/60 px-3 py-2.5">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-ink-950">
                <Landmark className="h-3.5 w-3.5 text-cyan-600" /> Endeksa (bölge endeksi)
              </span>
              <StatusPill ok={endeksaConfigured} okLabel="Bağlı" badLabel="Bekliyor" />
            </div>
            <div className="flex items-center justify-between rounded-[var(--radius-card)] border border-line bg-canvas/60 px-3 py-2.5">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-ink-950">
                <MapPinned className="h-3.5 w-3.5 text-mint-600" /> Tapusor (EDİ + yatırım puanı)
              </span>
              <StatusPill ok={tapusorConfigured} okLabel="Bağlı" badLabel="Bekliyor" />
            </div>
          </div>
          <p className="mt-4 text-xs text-text-muted">Deploy sonrası cron doğrulaması:</p>
          <code className="mt-2 block rounded-[var(--radius-control)] bg-ink-950 px-3 py-2 text-xs text-mint-300">
            npm run cron:smoke
          </code>
        </section>
      </div>

      {/* Şema / migration durumu — salt okunur yoklama, hiçbir şey yazmaz */}
      <section className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
              <Layers className="h-4 w-4" /> Şema &amp; migration
            </p>
            <h2 className="mt-1 font-display font-bold text-ink-950">Bu ortama uygulanmış migration&apos;lar</h2>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${
              schemaMissing.length === 0 ? "bg-mint-500/12 text-mint-600" : "bg-danger-500/10 text-danger-500"
            }`}
          >
            {schemaMissing.length === 0 ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
            {schemaMissing.length === 0 ? "Tümü uygulanmış" : `${schemaMissing.length} eksik`}
          </span>
        </div>

        {schemaMissing.length > 0 ? (
          <div className="border-b border-line bg-danger-500/[0.04] px-5 py-4">
            <p className="text-sm font-semibold text-ink-950">Eksik migration&apos;lar için güvenli yayın sırası:</p>
            <code className="mt-2 block overflow-x-auto whitespace-pre rounded-[var(--radius-control)] bg-ink-950 px-3 py-2 text-xs leading-relaxed text-mint-300">
              {`npm run check:migrations -- --database\nnpm run db:migrate -- --dry-run\n# Backup/PITR doğrulandıktan sonra:\nnpm run db:migrate`}
            </code>
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <div className="min-w-[520px] divide-y divide-line">
            {schemaRows.map((r) => (
              <div key={`${r.table}.${r.column ?? ""}`} className="flex items-center justify-between gap-3 px-5 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink-950">{r.label}</p>
                  <p className="numeric truncate text-xs text-text-faint">
                    {r.column ? `${r.table}.${r.column}` : r.table} · {r.migration}
                  </p>
                </div>
                {r.ok ? (
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-mint-500/12 px-2.5 py-1 text-xs font-bold text-mint-600">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Uygulanmış
                  </span>
                ) : (
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-danger-500/10 px-2.5 py-1 text-xs font-bold text-danger-500">
                    <XCircle className="h-3.5 w-3.5" /> {r.detail ?? "Eksik"}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
        <p className="border-t border-line px-5 py-3 text-xs leading-relaxed text-text-faint">
          Bu panel şemayı <strong>yalnızca okur</strong>: her satır için tek bir başlık sorgusu (head request) atılıp
          hata kodu değerlendirilir — veri taşınmaz, hiçbir şey değiştirilmez. Tam denetim için{" "}
          <code className="rounded bg-canvas px-1">npx tsx scripts/check-schema.ts</code>.
        </p>
      </section>

      {/* Yapay zeka anahtarı */}
      <OpenAiKeyForm
        configured={Boolean(activeKey)}
        source={keySource}
        masked={maskedKey}
        canEdit={staff.role === "super_admin"}
      />

      {/* Endeksa & Tapusor anahtarları */}
      <div className="grid gap-4 lg:grid-cols-2">
        <EndeksaKeyForm
          configured={endeksaConfigured}
          maskedClientId={maskedEndeksaId}
          canEdit={staff.role === "super_admin"}
        />
        <TapusorKeyForm
          configured={tapusorConfigured}
          maskedApiKey={maskedTapusorKey}
          canEdit={staff.role === "super_admin"}
        />
      </div>

      {/* Portal API anahtarları */}
      <PortalApiKeysSection
        canEdit={staff.role === "super_admin"}
        sahibindenConfigured={Boolean(sahibindenConfig)}
        hepsiemlakConfigured={Boolean(hepsiemlakConfig)}
        zingatConfigured={Boolean(zingatConfig)}
        emlakjetConfigured={Boolean(emlakjetConfig)}
        maskedSahibinden={maskedSahibinden}
        maskedHepsiemlak={maskedHepsiemlak}
        maskedZingat={maskedZingat}
        maskedEmlakjet={maskedEmlakjet}
      />

      {/* Bilinçli ertelenenler */}
      <section className="rounded-[var(--radius-panel)] border border-dashed border-line-strong bg-surface px-6 py-6">
        <p className="flex items-center gap-2 text-xs font-semibold text-text-muted">
          <Database className="h-3.5 w-3.5" /> Bilinçli ertelenen dış entegrasyonlar (C2–C3)
        </p>
        <ul className="mt-3 space-y-1.5 text-sm text-text-muted">
          <li>
            • <strong className="text-ink-950">İYS entegratör (C2):</strong> Resmi entegratör (vendor) sözleşmesi
            gerektirir — manuel süreç şu an aktif.
          </li>
          <li>
            • <strong className="text-ink-950">EİDS resmi kayıt (C3):</strong> e-Devlet/GİB API erişimi gerektirir —
            checkbox tabanlı beyan şu an aktif, resmi kayıt entegrasyonu vendor onayı sonrası.
          </li>
        </ul>
      </section>
    </div>
  );
}
