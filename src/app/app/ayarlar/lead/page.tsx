import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Zap } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { LeadCapturePanel } from "./lead-capture-panel";
import { VitrinQr } from "@/components/public/vitrin-qr";
import { getBaseUrl } from "@/lib/base-url";

import { PageHeader } from "@/components/ui/page-header";
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

  const baseUrl = getBaseUrl();
  const token = tenant?.lead_capture_token ?? "";
  const enabled = tenant?.lead_capture_enabled !== false;
  const vitrinUrl = tenant?.slug ? `${baseUrl}/vitrin/${tenant.slug}` : "";

  return (
    <div className="space-y-6">
      <Link href="/app/ayarlar" className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600">
        <ArrowLeft className="h-4 w-4" /> Ayarlara dön
      </Link>

      <PageHeader title="Gelen aday & hızlı yanıt" eyebrow="Aday yakalama" description="Web sitesi formu, reklam veya portal adaylarını CRM'e otomatik düşürün. Her aday sırayla en uygun danışmana atanır ve anında bildirim gönderilir." actions={
<div className="theme-dark flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] bg-[image:var(--grad-ink)] p-2"><Link
            href="/app/musteriler"
            className="focus-ring press lift group relative block rounded-[var(--radius-card)] border border-white/12 bg-white/[0.05] px-5 py-3 text-center transition hover:border-mint-400/40"
          >
            <ArrowUpRight className="hover-action absolute right-2 top-2 h-4 w-4 text-white/40 opacity-0 transition group-hover:text-mint-300 group-hover:opacity-100" />
            <p className="flex items-center justify-center gap-1.5 font-display text-2xl font-extrabold text-mint-300">
              <Zap className="h-5 w-5" /> {leadCount ?? 0}
            </p>
            <p className="text-xs text-white/50">otomatik atanan aday · müşterilere git</p>
          </Link></div>
} />

      <LeadCapturePanel token={token} enabled={enabled} baseUrl={baseUrl} vitrinUrl={vitrinUrl} />

      {/* Vitrin QR kodu — basılı materyal için indirme + yazdırma */}
      <VitrinQr vitrinUrl={vitrinUrl} />
    </div>
  );
}
