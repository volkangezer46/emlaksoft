import Link from "next/link";
import { ArrowUpRight, Bug, CheckCircle2, Clock3, Database, HeartPulse, KeyRound, Landmark, Layers, MapPin, Radar, XCircle } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { geoRowCount } from "@/lib/geo/reader";
import { AdminStatCard, AdminStatGrid } from "@/components/admin/admin-stat-card";
import { probeSchema } from "./schema-checks";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { getPlatformSetting } from "@/lib/platform-settings";
import { getPlatformSecret } from "@/lib/settings/secret-read";
import { relativeTimeTR } from "@/lib/admin-format";
import { msSince } from "@/lib/clock";
import { CRON_JOBS } from "@/lib/cron-jobs";
import { OpenAiKeyForm } from "@/components/admin/openai-key-form";
import { getEmlakFiyatiAdminStatus } from "@/lib/integrations/emlakfiyati/admin-status";
import { PortalApiKeysSection } from "@/components/admin/portal-keys-form";
import { getPortalConfig } from "@/lib/integrations/portals";
import { CronRunButton } from "./cron-run-button";
import { MessagingKeysSection } from "./messaging-keys-form";

const TOTAL_PROVINCES = 81;

type Heartbeat = { job: string; last_run_at: string; last_status: string; last_detail: string | null };

const DETAIL_KEYS: Record<string, string> = {
  claimed: "alındı",
  completed: "tamamlandı",
  failed: "başarısız",
  processed: "işlendi",
  sent: "gönderildi",
  skipped: "atlandı",
  errors: "hata",
  error: "hata",
  retried: "yeniden denendi",
  total: "toplam",
  updated: "güncellendi",
  inserted: "eklendi",
  deleted: "silindi",
};

/** Cron ayrıntısı JSON ise okunur özet satırına çevirir ("alındı 0 · tamamlandı 0"); değilse olduğu gibi. */
function formatCronDetail(detail: string): string {
  const t = detail.trim();
  if (!t.startsWith("{")) return detail;
  try {
    const obj = JSON.parse(t) as Record<string, unknown>;
    const parts = Object.entries(obj)
      .filter(([, v]) => typeof v === "number" || typeof v === "string" || typeof v === "boolean")
      .map(([k, v]) => `${DETAIL_KEYS[k] ?? k.replace(/_/g, " ")} ${typeof v === "boolean" ? (v ? "evet" : "hayır") : v}`);
    return parts.length > 0 ? parts.join(" · ") : detail;
  } catch {
    return detail;
  }
}

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

export async function SystemView() {
  const staff = await requirePlatformModule("sistem");
  const admin = createAdminClient();

  // Tüm platform ayarları + geo sayımları tek turda (bağımsız → tam paralel)
  const [
    dbKey,
    emlakFiyatiStatus,
    dbNetgsmUser, dbNetgsmPass, dbNetgsmHeader, dbWaUrl, dbWaToken,
    sahibindenConfig, hepsiemlakConfig, zingatConfig, emlakjetConfig,
    { count: provinces }, { count: districts }, { count: neighborhoods },
    { data: heartbeatRows },
    schemaRows,
    { count: openErrors },
    { data: manualRunRows },
  ] = await Promise.all([
    getPlatformSecret("openai_api_key"),
    getEmlakFiyatiAdminStatus(),
    getPlatformSetting("netgsm_usercode"),
    getPlatformSecret("netgsm_password"),
    getPlatformSetting("netgsm_msgheader"),
    getPlatformSetting("whatsapp_api_url"),
    getPlatformSecret("whatsapp_api_token"),
    getPortalConfig("sahibinden"),
    getPortalConfig("hepsiemlak"),
    getPortalConfig("zingat"),
    getPortalConfig("emlakjet"),
    geoRowCount("province"),
    geoRowCount("district"),
    geoRowCount("neighborhood"),
    admin.from("cron_heartbeats").select("job, last_run_at, last_status, last_detail"),
    probeSchema(),
    admin.from("error_logs").select("id", { count: "exact", head: true }).is("resolved_at", null),
    admin
      .from("platform_audit_logs")
      .select("id, actor_id, meta, created_at")
      .eq("action", "platform_cron.run")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  const canRun = staff.role === "super_admin";
  type ManualRun = { id: string; actor_id: string | null; meta: { job?: string; label?: string; status?: number; ok?: boolean; duration_ms?: number } | null; created_at: string };
  const manualRuns = (manualRunRows ?? []) as ManualRun[];
  const runActorIds = [...new Set(manualRuns.map((r) => r.actor_id).filter(Boolean))] as string[];
  const { data: runActors } = runActorIds.length
    ? await admin.from("platform_staff").select("id, full_name").in("id", runActorIds)
    : { data: [] as { id: string; full_name: string }[] };
  const runActorName = new Map((runActors ?? []).map((a) => [a.id, a.full_name] as const));
  const lastManualByJob = new Map<string, ManualRun>();
  for (const r of manualRuns) if (r.meta?.job && !lastManualByJob.has(r.meta.job)) lastManualByJob.set(r.meta.job, r);

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

  // EmlakFiyati — anahtar admin'de şifreli (veya env yedek); değeri ASLA gösterilmez (yalnız durum).
  const emlakFiyatiConfigured = emlakFiyatiStatus.configured;
  const emlakFiyatiLastOk = emlakFiyatiStatus.lastOkAt;
  const emlakFiyatiAlarm = emlakFiyatiStatus.authAlarm;

  // Portal API anahtarları
  const sahibindenKey  = sahibindenConfig?.apiKey ?? null;
  const hepsiemlakKey  = hepsiemlakConfig?.apiKey ?? null;
  const zingatKey      = zingatConfig?.apiKey ?? null;
  const emlakjetKey    = emlakjetConfig?.apiKey ?? null;

  const maskedSahibinden  = sahibindenKey  ? mask(sahibindenKey)  : null;
  const maskedHepsiemlak  = hepsiemlakKey  ? mask(hepsiemlakKey)  : null;
  const maskedZingat      = zingatKey      ? mask(zingatKey)      : null;
  const maskedEmlakjet    = emlakjetKey    ? mask(emlakjetKey)    : null;

  // Netgsm / WhatsApp — DB öncelikli, env yedek; ekrana yalnız maskeli özet düşer (parola/anahtar asla)
  const netgsmUser = dbNetgsmUser?.trim() || process.env.NETGSM_USERCODE?.trim() || null;
  const netgsmHeader = dbNetgsmHeader?.trim() || process.env.NETGSM_MSGHEADER?.trim() || null;
  const netgsmConfigured = Boolean(netgsmUser && (dbNetgsmPass?.trim() || process.env.NETGSM_PASSWORD) && netgsmHeader);
  const waUrl = dbWaUrl?.trim() || process.env.WHATSAPP_API_URL?.trim() || null;
  const waConfigured = Boolean(waUrl && (dbWaToken?.trim() || process.env.WHATSAPP_API_TOKEN));
  let waHost: string | null = null;
  try {
    waHost = waUrl ? new URL(waUrl).hostname : null;
  } catch {
    waHost = null;
  }

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
        description="Geo kapsama, cron güvenliği, şema sürümü ve opsiyonel entegrasyonların (iyzico, EmlakFiyati, yapay zeka) canlı yapılandırma durumu."
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
            href="/admin/sistem?sekme=hatalar"
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
            href="/admin/sistem?sekme=hatalar"
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
                      {hb?.last_detail ? ` · ${formatCronDetail(hb.last_detail)}` : ""}
                      {lastManualByJob.get(job)
                        ? ` · elle: ${relativeTimeTR(lastManualByJob.get(job)!.created_at)}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
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
                  {canRun ? <CronRunButton job={job} label={label} /> : null}
                  </div>
                </div>
              );
            })}
          </div>
          {manualRuns.length > 0 ? (
            <div className="mt-4 border-t border-line pt-3">
              <p className="text-xs font-semibold text-ink-950">Son elle çalıştırmalar ({manualRuns.length})</p>
              <ul className="mt-2 space-y-1.5">
                {manualRuns.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-muted">
                    <span className="min-w-0 truncate">
                      <span className="font-semibold text-ink-950">{r.meta?.label ?? r.meta?.job ?? "İş"}</span>
                      {" · "}
                      {r.actor_id ? (runActorName.get(r.actor_id) ?? r.actor_id.slice(0, 8)) : "Sistem"}
                      {typeof r.meta?.duration_ms === "number" ? ` · ${Math.round(r.meta.duration_ms / 100) / 10} sn` : ""}
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <span className={r.meta?.ok ? "font-semibold text-mint-700" : "font-semibold text-danger-600"}>
                        {r.meta?.ok ? "Başarılı" : `Hata${r.meta?.status ? ` (${r.meta.status})` : ""}`}
                      </span>
                      <span className="text-text-faint">{relativeTimeTR(r.created_at)}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <Link href="/admin/aktivite?kaynak=platform&islem=platform_cron.run" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline">
                Tüm kayıtlar <ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>
          ) : null}
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
            <div className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line bg-canvas/60 px-3 py-2.5">
              <span className="min-w-0 text-sm font-semibold text-ink-950">
                <span className="flex items-center gap-1.5">
                  <Landmark className="h-3.5 w-3.5 text-cyan-600" /> EmlakFiyati (bölge endeksi)
                </span>
                <span className="mt-0.5 block text-xs font-normal text-text-muted">
                  {emlakFiyatiAlarm
                    ? "Anahtar reddedildi (401): yeni anahtar girin"
                    : emlakFiyatiConfigured
                      ? emlakFiyatiLastOk
                        ? `Son başarılı çağrı: ${relativeTimeTR(emlakFiyatiLastOk)}`
                        : "Henüz başarılı çağrı kaydı yok"
                      : "API anahtarı tanımlı değil"}
                  {" · "}
                  <Link href="/admin/sistem?sekme=emlakfiyati" className="font-semibold text-brand-600 hover:underline">
                    Yönet
                  </Link>
                </span>
              </span>
              <StatusPill
                ok={emlakFiyatiConfigured && !emlakFiyatiAlarm}
                okLabel="Bağlı"
                badLabel={emlakFiyatiAlarm ? "Anahtar reddedildi" : "Bağlantı yok"}
              />
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

      {/* SMS / WhatsApp sağlayıcı bilgileri */}
      <MessagingKeysSection
        canEdit={staff.role === "super_admin"}
        netgsmConfigured={netgsmConfigured}
        netgsmSummary={netgsmUser ? `${netgsmUser}${netgsmHeader ? ` · ${netgsmHeader}` : ""}` : null}
        whatsappConfigured={waConfigured}
        whatsappSummary={waHost}
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
            • <strong className="text-ink-950">TTBS / EİDS resmi kayıt (C3):</strong> TTBS (Taşınmaz Ticareti Bilgi Sistemi) ve EİDS (Elektronik İlan Doğrulama Sistemi) ayrı sistemlerdir; ikisi için de resmi erişim gerekir —
            checkbox tabanlı beyan şu an aktif, resmi kayıt entegrasyonu erişim/onay sonrası.
          </li>
        </ul>
      </section>
    </div>
  );
}
