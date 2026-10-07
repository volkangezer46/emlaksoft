import Link from "@/components/ui/smart-link";
import { ArrowUpRight, Building2, Handshake, Users } from "lucide-react";
import type { createClient } from "@/lib/supabase/server";
import { getStageLabels } from "@/lib/definitions";

type Supabase = Awaited<ReturnType<typeof createClient>>;

type Event = { key: string; label: string; tone: string; title: string; sub: string | null; at: string; href: string };

const dateTime = (iso: string) =>
  new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" }).format(new Date(iso));

const ITEM = "focus-ring press group flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line bg-canvas/60 px-3 py-2 text-sm transition hover:border-brand-300";

type Rel = { title?: string | null; property_code?: string | null; full_name?: string | null } | { title?: string | null; property_code?: string | null; full_name?: string | null }[] | null;
const relOf = (v: Rel) => (Array.isArray(v) ? v[0] : v) ?? null;

/**
 * Aktivite sekmesinin tamamlayıcısı: danışmanın İLAN, MÜŞTERİ ve ANLAŞMA geçmişi tek zaman akışında
 * (çağrı/randevu/görev/teklif akışı mevcut bileşendedir; ikisi birlikte danışmanın tüm iş geçmişini verir).
 * Her satır kaydın detayına bağlanır; tümü için süzgeçli liste bağlantısı vardır.
 */
export async function ActivityExtra({ supabase, id }: { supabase: Supabase; id: string }) {
  const [stageLabels, props, customers, deals] = await Promise.all([
    getStageLabels(),
    supabase.from("properties").select("id, title, property_code, created_at").eq("assigned_to", id).is("deleted_at", null).order("created_at", { ascending: false }).limit(15),
    supabase.from("customers").select("id, full_name, created_at").eq("assigned_to", id).is("deleted_at", null).order("created_at", { ascending: false }).limit(15),
    supabase
      .from("deals")
      .select("id, stage, deal_value, updated_at, property:properties!deals_property_id_fkey(title, property_code), customer:customers!deals_customer_id_fkey(full_name)")
      .eq("assigned_to", id)
      .order("updated_at", { ascending: false })
      .limit(15),
  ]);

  const events: Event[] = [];
  for (const p of (props.data ?? []) as { id: string; title: string | null; property_code: string | null; created_at: string }[]) {
    events.push({ key: `p-${p.id}`, label: "İlan", tone: "bg-mint-500/15 text-mint-700", title: p.title ?? p.property_code ?? "Portföy", sub: "Portföy atandı / eklendi", at: p.created_at, href: `/app/portfoyler/${p.id}` });
  }
  for (const c of (customers.data ?? []) as { id: string; full_name: string; created_at: string }[]) {
    events.push({ key: `c-${c.id}`, label: "Müşteri", tone: "bg-cyan-500/15 text-cyan-700", title: c.full_name, sub: "Müşteri atandı / eklendi", at: c.created_at, href: `/app/musteriler/${c.id}` });
  }
  for (const d of (deals.data ?? []) as unknown as { id: string; stage: string; deal_value: number | null; updated_at: string; property: Rel; customer: Rel }[]) {
    const prop = relOf(d.property);
    events.push({
      key: `d-${d.id}`,
      label: "Anlaşma",
      tone: "bg-brand-600/10 text-brand-700",
      title: prop?.title ?? prop?.property_code ?? relOf(d.customer)?.full_name ?? "Anlaşma",
      sub: [(stageLabels as Record<string, { label: string }>)[d.stage]?.label ?? d.stage, relOf(d.customer)?.full_name].filter(Boolean).join(" · "),
      at: d.updated_at,
      href: `/app/anlasmalar/${d.id}`,
    });
  }
  const sorted = events.filter((e) => Number.isFinite(Date.parse(e.at))).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 30);
  if (sorted.length === 0) return null;

  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      <h2 className="mb-3 flex flex-wrap items-center gap-2 text-sm font-bold text-ink-950">
        İlan, müşteri ve anlaşma geçmişi
        <span className="ml-auto text-xs font-normal text-text-muted">portföy, müşteri, anlaşma</span>
      </h2>
      <ol className="space-y-1.5">
        {sorted.map((e) => (
          <li key={e.key}>
            <Link href={e.href} className={ITEM}>
              <span className="flex min-w-0 items-center gap-3">
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${e.tone}`}>{e.label}</span>
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink-950 group-hover:text-brand-600">{e.title}</span>
                  {e.sub ? <span className="block truncate text-xs text-text-muted">{e.sub}</span> : null}
                </span>
              </span>
              <time dateTime={e.at} className="shrink-0 text-xs text-text-muted">{dateTime(e.at)}</time>
            </Link>
          </li>
        ))}
      </ol>
      <div className="mt-3 flex flex-wrap gap-4 text-xs font-semibold text-brand-600">
        <Link href={`/app/portfoyler?danisman=${id}`} className="inline-flex items-center gap-1 hover:underline"><Building2 className="h-3.5 w-3.5" /> Tüm ilanları <ArrowUpRight className="h-3.5 w-3.5" /></Link>
        <Link href={`/app/musteriler?assigned=${id}`} className="inline-flex items-center gap-1 hover:underline"><Users className="h-3.5 w-3.5" /> Tüm müşterileri <ArrowUpRight className="h-3.5 w-3.5" /></Link>
        <Link href={`/app/anlasmalar?danisman=${id}`} className="inline-flex items-center gap-1 hover:underline"><Handshake className="h-3.5 w-3.5" /> Tüm anlaşmaları <ArrowUpRight className="h-3.5 w-3.5" /></Link>
      </div>
    </section>
  );
}
