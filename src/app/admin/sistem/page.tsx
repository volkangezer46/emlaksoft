import Link from "next/link";
import { ArrowUpRight, CheckCircle2, Database, KeyRound, Landmark, MapPin, MapPinned, Radar, XCircle } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { getPlatformSetting } from "@/lib/platform-settings";
import { OpenAiKeyForm } from "@/components/admin/openai-key-form";
import { EndeksaKeyForm, TapusorKeyForm } from "@/components/admin/integration-keys-form";
import { PortalApiKeysSection } from "@/components/admin/portal-keys-form";

const TOTAL_PROVINCES = 81;

function StatusPill({ ok, okLabel, badLabel }: { ok: boolean; okLabel: string; badLabel: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${
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

  // OpenAI
  const dbKey = await getPlatformSetting("openai_api_key");
  const envKey = process.env.OPENAI_API_KEY?.trim() || null;
  const activeKey = (dbKey?.trim() || envKey) ?? null;
  const keySource: "db" | "env" | "none" = dbKey?.trim() ? "db" : envKey ? "env" : "none";
  const maskedKey = activeKey ? mask(activeKey) : null;

  // Endeksa — DB öncelikli
  const [
    dbEndeksaId, dbEndeksaSecret, dbTapusorKey,
    dbSahibindenKey, dbHepsiemlakKey, dbZingatKey,
  ] = await Promise.all([
    getPlatformSetting("endeksa_client_id"),
    getPlatformSetting("endeksa_client_secret"),
    getPlatformSetting("tapusor_api_key"),
    getPlatformSetting("sahibinden_api_key"),
    getPlatformSetting("hepsiemlak_api_key"),
    getPlatformSetting("zingat_api_key"),
  ]);

  const endeksaClientId = dbEndeksaId?.trim() || process.env.ENDEKSA_CLIENT_ID?.trim() || null;
  const endeksaSecret = dbEndeksaSecret?.trim() || process.env.ENDEKSA_CLIENT_SECRET?.trim() || null;
  const tapusorApiKey = dbTapusorKey?.trim() || process.env.TAPUSOR_API_KEY?.trim() || null;

  const endeksaConfigured = Boolean(endeksaClientId && endeksaSecret);
  const tapusorConfigured = Boolean(tapusorApiKey);

  // Portal API anahtarları
  const sahibindenKey  = dbSahibindenKey?.trim()  || process.env.SAHIBINDEN_API_KEY?.trim()  || null;
  const hepsiemlakKey  = dbHepsiemlakKey?.trim()  || process.env.HEPSIEMLAK_API_KEY?.trim()  || null;
  const zingatKey      = dbZingatKey?.trim()      || process.env.ZINGAT_API_KEY?.trim()      || null;

  const maskedSahibinden  = sahibindenKey  ? mask(sahibindenKey)  : null;
  const maskedHepsiemlak  = hepsiemlakKey  ? mask(hepsiemlakKey)  : null;
  const maskedZingat      = zingatKey      ? mask(zingatKey)      : null;

  // Endeksa/Tapusor masked değerler (güvenli gösterim)
  const maskedEndeksaId = endeksaClientId ? mask(endeksaClientId, 4, 3) : null;
  const maskedTapusorKey = tapusorApiKey ? mask(tapusorApiKey) : null;

  // Geo
  const [{ count: provinces }, { count: districts }, { count: neighborhoods }] = await Promise.all([
    admin.from("geo_provinces").select("id", { count: "exact", head: true }),
    admin.from("geo_districts").select("id", { count: "exact", head: true }),
    admin.from("geo_neighborhoods").select("id", { count: "exact", head: true }),
  ]);

  const provinceCoverage = Math.round(((provinces ?? 0) / TOTAL_PROVINCES) * 100);
  const cronConfigured = Boolean(process.env.CRON_SECRET?.trim());
  const pushConfigured = Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
  const iyzicoConfigured = Boolean(process.env.IYZICO_API_KEY && process.env.IYZICO_SECRET_KEY);

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="relative">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-amber-300">
            <Radar className="h-3.5 w-3.5" /> Sistem sağlığı
          </p>
          <h1 className="mt-2 font-display text-3xl font-extrabold">Altyapı &amp; entegrasyon durumu</h1>
          <p className="mt-2 max-w-xl text-sm text-white/60">
            Geo kapsama, cron güvenliği ve opsiyonel entegrasyonların (iyzico, Endeksa, Tapusor, yapay zeka) canlı yapılandırma durumu.
          </p>
        </div>
      </section>

      {/* Geo + ortam değişkenleri */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-[20px] border border-line bg-surface p-5">
          <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
            <MapPin className="h-4 w-4" /> Geo kapsama (D3)
          </p>
          <h2 className="mt-1 font-display font-bold text-ink-950">İl / ilçe / mahalle</h2>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="rounded-[12px] border border-line bg-canvas/60 p-3 text-center">
              <p className="font-display text-xl font-extrabold text-ink-950">{provinces ?? 0}/{TOTAL_PROVINCES}</p>
              <p className="text-[10px] text-text-muted">İl (%{provinceCoverage})</p>
            </div>
            <div className="rounded-[12px] border border-line bg-canvas/60 p-3 text-center">
              <p className="font-display text-xl font-extrabold text-ink-950">{(districts ?? 0).toLocaleString("tr-TR")}</p>
              <p className="text-[10px] text-text-muted">İlçe</p>
            </div>
            <div className="rounded-[12px] border border-line bg-canvas/60 p-3 text-center">
              <p className="font-display text-xl font-extrabold text-ink-950">{(neighborhoods ?? 0).toLocaleString("tr-TR")}</p>
              <p className="text-[10px] text-text-muted">Mahalle</p>
            </div>
          </div>
          <p className="mt-4 text-xs text-text-muted">
            81 il, 973 ilçe ve 31.900+ mahalle TurkiyeAPI kaynağından senkronize edildi. Yeniden senkron için:
          </p>
          <code className="mt-2 block rounded-[10px] bg-ink-950 px-3 py-2 text-[11px] text-mint-300">
            npm run geo:sync
          </code>
          <p className="mt-2 text-[11px] text-text-faint">
            Kaynak: TurkiyeAPI v2 statik veri seti — çeyreklik yeniden senkron önerilir (<code>scripts/geo-sync.ts</code>).
          </p>
          <Link
            href="/admin/geo"
            className="mt-4 inline-flex items-center gap-1.5 rounded-[10px] border border-line px-3 py-2 text-xs font-semibold text-brand-600 transition hover:border-brand-400"
          >
            Coğrafya yönetimine git <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </section>

        <section className="rounded-[20px] border border-line bg-surface p-5">
          <p className="flex items-center gap-2 text-xs font-semibold text-amber-600">
            <KeyRound className="h-4 w-4" /> Altyapı &amp; güvenlik
          </p>
          <h2 className="mt-1 font-display font-bold text-ink-950">Ortam değişkenleri</h2>
          <div className="mt-4 space-y-2.5">
            <div className="flex items-center justify-between rounded-[12px] border border-line bg-canvas/60 px-3 py-2.5">
              <span className="text-sm font-semibold text-ink-950">CRON_SECRET</span>
              <StatusPill ok={cronConfigured} okLabel="Tanımlı" badLabel="Eksik" />
            </div>
            <div className="flex items-center justify-between rounded-[12px] border border-line bg-canvas/60 px-3 py-2.5">
              <span className="text-sm font-semibold text-ink-950">iyzico (canlı tahsilat)</span>
              <StatusPill ok={iyzicoConfigured} okLabel="Tanımlı" badLabel="Demo mod" />
            </div>
            <div className="flex items-center justify-between rounded-[12px] border border-line bg-canvas/60 px-3 py-2.5">
              <span className="text-sm font-semibold text-ink-950">VAPID push (bildirim)</span>
              <StatusPill ok={pushConfigured} okLabel="Tanımlı" badLabel="Kapalı" />
            </div>
            <div className="flex items-center justify-between rounded-[12px] border border-line bg-canvas/60 px-3 py-2.5">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-ink-950">
                <Landmark className="h-3.5 w-3.5 text-cyan-600" /> Endeksa (bölge endeksi)
              </span>
              <StatusPill ok={endeksaConfigured} okLabel="Bağlı" badLabel="Bekliyor" />
            </div>
            <div className="flex items-center justify-between rounded-[12px] border border-line bg-canvas/60 px-3 py-2.5">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-ink-950">
                <MapPinned className="h-3.5 w-3.5 text-violet-600" /> Tapusor (EDİ + yatırım puanı)
              </span>
              <StatusPill ok={tapusorConfigured} okLabel="Bağlı" badLabel="Bekliyor" />
            </div>
          </div>
          <p className="mt-4 text-xs text-text-muted">Deploy sonrası cron doğrulaması:</p>
          <code className="mt-2 block rounded-[10px] bg-ink-950 px-3 py-2 text-[11px] text-mint-300">
            npm run cron:smoke
          </code>
        </section>
      </div>

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
        sahibindenConfigured={Boolean(sahibindenKey)}
        hepsiemlakConfigured={Boolean(hepsiemlakKey)}
        zingatConfigured={Boolean(zingatKey)}
        maskedSahibinden={maskedSahibinden}
        maskedHepsiemlak={maskedHepsiemlak}
        maskedZingat={maskedZingat}
      />

      {/* Bilinçli ertelenenler */}
      <section className="rounded-[20px] border border-dashed border-line-strong bg-surface px-6 py-6">
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
