import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { LeadForm } from "./lead-form";

export const dynamic = "force-dynamic";

export default async function PublicLeadPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();

  const { data: tenant } = await admin
    .from("tenants")
    .select("name, logo_url, brand_color, lead_capture_enabled")
    .eq("lead_capture_token", token)
    .maybeSingle();

  if (!tenant) notFound();

  const { data: provinces } = await admin
    .from("geo_provinces")
    .select("id, name")
    .eq("is_active", true)
    .order("name");

  const closed = tenant.lead_capture_enabled === false;

  return (
    <div className="min-h-screen bg-[image:var(--grad-ink)] px-4 py-10 text-white sm:py-16">
      <div className="pointer-events-none fixed inset-0 -z-10 grid-overlay-dark opacity-30" />
      <div className="pointer-events-none fixed -right-20 -top-20 -z-10 h-72 w-72 rounded-full bg-brand-600/25 blur-[110px]" />
      <div className="pointer-events-none fixed -left-16 bottom-0 -z-10 h-64 w-64 rounded-full bg-mint-500/20 blur-[110px]" />

      <div className="mx-auto max-w-lg">
        <div className="mb-5 flex items-center justify-center gap-2 text-xs font-semibold text-white/60">
          <span className="grid h-7 w-7 place-items-center rounded-[9px] bg-white/10 text-[12px] font-bold text-white">
            {tenant.name ? tenant.name[0] : "E"}
          </span>
          {tenant.name || "EmlakSoft"}
        </div>

        <div className="overflow-hidden rounded-[24px] border border-white/15 bg-white/[0.06] p-6 shadow-[0_30px_80px_-40px_rgba(0,0,0,0.7)] backdrop-blur-xl sm:p-8">
          <h1 className="font-display text-2xl font-extrabold leading-tight sm:text-3xl">
            Size en uygun mülkü bulalım
          </h1>
          <p className="mt-2 text-sm text-white/55">
            Talebinizi bırakın, uzman danışmanımız kısa süre içinde sizinle iletişime geçsin.
          </p>

          {closed ? (
            <p className="mt-6 rounded-[12px] border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-white/60">
              Bu form şu anda kapalı. Lütfen daha sonra tekrar deneyin.
            </p>
          ) : (
            <LeadForm token={token} provinces={provinces ?? []} />
          )}
        </div>

        <p className="mt-6 text-center text-[11px] text-white/30">
          Powered by EmlakSoft — Türkiye&apos;nin emlak işletim sistemi
        </p>
      </div>
    </div>
  );
}
