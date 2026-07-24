import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2, Calendar, Mail, MapPin, Phone, Users } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { DemoCard, type DemoRow } from "../demo-card";

const STATUS_LABELS: Record<string, string> = {
  new: "Yeni",
  contacted: "İletişimde",
  qualified: "Nitelikli",
  won: "Kazanıldı",
  lost: "Kaybedildi",
};

function dateTime(iso: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export default async function AdminLeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePlatformModule("sales");
  const { id } = await params;
  const admin = createAdminClient();

  const [{ data: lead }, { data: staff }] = await Promise.all([
    admin
      .from("demo_requests")
      .select("id, full_name, phone, email, company, city, team_size, message, source, status, assigned_to, notes, converted_tenant_id, created_at, updated_at")
      .eq("id", id)
      .maybeSingle(),
    admin.from("platform_staff").select("id, full_name").eq("is_active", true),
  ]);

  if (!lead) notFound();

  let convertedTenant: { id: string; name: string } | null = null;
  if (lead.converted_tenant_id) {
    const { data: t } = await admin.from("tenants").select("id, name").eq("id", lead.converted_tenant_id).maybeSingle();
    convertedTenant = t ?? null;
  }

  const staffList = staff ?? [];
  const facts = [
    { icon: Phone, label: "Telefon", value: lead.phone || "—" },
    { icon: Mail, label: "E-posta", value: lead.email || "—" },
    { icon: Building2, label: "Şirket", value: lead.company || "—" },
    { icon: MapPin, label: "Şehir", value: lead.city || "—" },
    { icon: Users, label: "Ekip", value: lead.team_size || "—" },
    { icon: Calendar, label: "Geliş", value: dateTime(lead.created_at) },
  ];

  return (
    <div className="space-y-6">
      <Link href="/admin/satis" className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600">
        <ArrowLeft className="h-4 w-4" /> Satış CRM
      </Link>

      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-amber-300">Aday · {lead.source}</p>
            <h1 className="mt-2 font-display text-3xl font-extrabold">{lead.full_name}</h1>
            <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-white/70">
              <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-semibold">{STATUS_LABELS[lead.status] ?? lead.status}</span>
              {convertedTenant ? (
                <Link href={`/admin/tenants/${convertedTenant.id}`} className="rounded-full bg-mint-500/20 px-2.5 py-0.5 text-[11px] font-bold text-mint-300 hover:bg-mint-500/30">
                  Ofise dönüştürüldü: {convertedTenant.name} →
                </Link>
              ) : null}
            </p>
          </div>
          <div className="flex gap-2">
            {lead.phone ? (
              <a href={`tel:${lead.phone}`} className="rounded-[10px] bg-white px-4 py-2.5 text-sm font-semibold text-ink-950">Ara</a>
            ) : null}
          </div>
        </div>
        <div className="relative mt-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {facts.map((f) => (
            <div key={f.label} className="rounded-[14px] border border-white/10 bg-white/5 p-3">
              <f.icon className="h-4 w-4 text-cyan-400" />
              <p className="mt-1.5 truncate text-sm font-semibold text-white" title={f.value}>{f.value}</p>
              <p className="text-[10px] text-white/45">{f.label}</p>
            </div>
          ))}
        </div>
      </section>

      {lead.message ? (
        <section className="rounded-[18px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <h2 className="mb-2 text-sm font-bold text-ink-950">Talep mesajı</h2>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-800">{lead.message}</p>
        </section>
      ) : null}

      {/* İşlemler — mevcut DemoCard (durum/atama/not/dönüştür) */}
      <DemoCard row={lead as DemoRow} staff={staffList} />
    </div>
  );
}
