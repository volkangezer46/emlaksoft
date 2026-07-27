import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Radio, Zap } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { LeadCapturePanel } from "./lead-capture-panel";
import { VitrinQr } from "@/components/public/vitrin-qr";

export const dynamic = "force-dynamic";

export default async function LeadCaptureSettingsPage() {
  const ctx = await requireModulePage("settings");
  const supabase = await createClient();

  // tenant fetch + lead count bağımsız (ikisi de yalnızca tenantId'ye bağlı) → paralel
  const [{ data: tenant }, { count: leadCount }] = await Promise.all([
    supabase
      .from("tenants")
      .select("lead_capture_token, lead_capture_enabled, slug")
      .eq("id", ctx.tenantId)
      .maybeSingle(),
    supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", ctx.tenantId)
      .eq("auto_assigned", true),
  ]);

  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const token = tenant?.lead_capture_token ?? "";
  const enabled = tenant?.lead_capture_enabled !== false;
  const vitrinUrl = tenant?.slug ? `${baseUrl}/vitrin/${tenant.slug}` : "";

  return (
    <div className="space-y-6">
      <Link href="/app/ayarlar" className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600">
        <ArrowLeft className="h-4 w-4" /> Ayarlara dön
      </Link>

      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-4 text-white md:p-6">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-60 w-60 rounded-full bg-mint-500/30 blur-[80px]" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-mint-400">
              <Radio className="h-4 w-4" /> Aday yakalama
            </span>
            <h1 className="mt-2 font-display text-2xl font-extrabold md:text-3xl">Gelen aday & hızlı yanıt</h1>
            <p className="mt-1 max-w-xl text-sm text-white/60">
              Web sitesi formu, reklam veya portal adaylarını CRM&apos;e otomatik düşürün. Her aday sırayla
              en uygun danışmana atanır ve anında bildirim gönderilir.
            </p>
          </div>
          <Link
            href="/app/musteriler"
            className="focus-ring press lift group relative block rounded-[14px] border border-white/12 bg-white/[0.05] px-5 py-3 text-center transition hover:border-mint-400/40"
          >
            <ArrowUpRight className="hover-action absolute right-2 top-2 h-4 w-4 text-white/40 opacity-0 transition group-hover:text-mint-300 group-hover:opacity-100" />
            <p className="flex items-center justify-center gap-1.5 font-display text-2xl font-extrabold text-mint-300">
              <Zap className="h-5 w-5" /> {leadCount ?? 0}
            </p>
            <p className="text-[11px] text-white/50">otomatik atanan aday · müşterilere git</p>
          </Link>
        </div>
      </section>

      <LeadCapturePanel token={token} enabled={enabled} baseUrl={baseUrl} vitrinUrl={vitrinUrl} />

      {/* Vitrin QR kodu — basılı materyal için indirme + yazdırma */}
      <VitrinQr vitrinUrl={vitrinUrl} />
    </div>
  );
}
