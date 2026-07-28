import Link from "next/link";
import { ArrowLeft, Droplets, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { sanitizeWatermarkSettings } from "@/lib/watermark";
import { WatermarkForm } from "./watermark-form";

export const dynamic = "force-dynamic";

export default async function WatermarkSettingsPage() {
  const ctx = await requireModulePage("settings");
  const supabase = await createClient();

  const [{ data: tenant }, { data: sample }] = await Promise.all([
    supabase
      .from("tenants")
      .select("name, logo_url, watermark_settings")
      .eq("id", ctx.tenantId)
      .maybeSingle(),
    // Önizleme için gerçek bir ilan fotoğrafı: `/api/property-media/[id]` yalnızca
    // yayında (taslak/silinmemiş) portföyleri servis ettiğinden aynı filtre burada
    // uygulanır — 404 dönecek bir görsel seçilmez. Yoksa yerleşik örnek çizilir.
    supabase
      .from("property_media")
      .select("id, property:properties!inner(status, deleted_at)")
      .eq("tenant_id", ctx.tenantId)
      .eq("kind", "image")
      .neq("property.status", "draft")
      .is("property.deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const settings = sanitizeWatermarkSettings(tenant?.watermark_settings ?? null);

  return (
    <div className="space-y-6">
      <Link
        href="/app/ayarlar"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600"
      >
        <ArrowLeft className="h-4 w-4" /> Ayarlara dön
      </Link>

      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-4 text-white md:p-6">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-60 w-60 rounded-full bg-brand-600/35 blur-[80px]" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-mint-400">
              <Droplets className="h-4 w-4" /> Fotoğraf filigranı
            </span>
            <h1 className="mt-2 font-display text-2xl font-extrabold md:text-3xl">İlanlarınızı damgalayın</h1>
            <p className="mt-1 max-w-xl text-sm text-white/60">
              Yüklenen her ilan fotoğrafına ofis logonuz veya adınız otomatik basılır. Fotoğrafınız
              başka bir ilanda kullanılsa bile kaynağı belli olur.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-[14px] border border-white/12 bg-white/[0.05] px-4 py-3 text-xs text-white/70">
            <ShieldCheck className="h-4 w-4 text-mint-400" />
            <span>
              Damga <strong className="text-white">yüklenen kopyaya</strong> basılır;
              <br />
              cihazınızdaki orijinal dosya bozulmaz.
            </span>
          </div>
        </div>
      </section>

      <section className="dashboard-panel rounded-[20px] border border-line bg-surface p-4 md:p-6">
        <WatermarkForm
          initial={settings}
          officeName={tenant?.name ?? ""}
          logoUrl={tenant?.logo_url ?? null}
          sampleMediaId={sample?.id ?? null}
        />
      </section>

      <section className="rounded-[20px] border border-line bg-canvas p-5 text-sm text-text-muted">
        <h2 className="font-display font-bold text-ink-950">Nasıl çalışır?</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-xs leading-relaxed">
          <li>Filigran, fotoğraf yüklenirken tarayıcıda basılır — sunucuya zaten damgalı gider.</li>
          <li>
            Ayar değişikliği <strong>bundan sonra</strong> yüklenecek fotoğrafları etkiler; daha önce
            yüklenmiş görseller yeniden damgalanmaz (orijinali sunucuda saklanmadığı için tekrar
            damgalamak kaliteyi düşürür ve üst üste damga bırakır).
          </li>
          <li>
            Logo bulunamaz veya tarayıcıya yüklenemezse (erişim/CORS) filigran sessizce{" "}
            <strong>metin moduna</strong> düşer; yükleme hiçbir durumda engellenmez.
          </li>
          <li>Animasyonlu GIF dosyalarına damga basılmaz (animasyon kaybolmasın diye).</li>
        </ul>
      </section>
    </div>
  );
}
