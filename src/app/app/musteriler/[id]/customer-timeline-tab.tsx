"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  FileSignature,
  History,
  MessageSquare,
  PhoneCall,
  Sparkles,
  Tag,
} from "lucide-react";

/**
 * Birleşik zaman tüneli öğesi — sunucuda (page.tsx) çağrı, randevu, teklif,
 * sözleşme, tamamlanan görev, iletişim kaydı ve müşteri kaydının açılışından
 * derlenir; burada yalnızca kronolojik olarak çizilir.
 */
export type TimelineItem = {
  key: string;
  kind: "call" | "appointment" | "offer" | "contract" | "task" | "comm" | "created";
  title: string;
  sub: string | null;
  time: string;
  href: string | null;
};

/* Tip → ikon + renkli nokta + ikon kutusu tonu (mevcut palet tokenları) */
const KIND_META: Record<TimelineItem["kind"], { icon: typeof PhoneCall; dot: string; tone: string; label: string }> = {
  call:        { icon: PhoneCall,     dot: "bg-brand-600",  tone: "bg-brand-600/10 text-brand-600",  label: "Görüşme" },
  comm:        { icon: MessageSquare, dot: "bg-cyan-500",   tone: "bg-cyan-400/12 text-cyan-500",    label: "Görüşme" },
  appointment: { icon: CalendarDays,  dot: "bg-mint-500",   tone: "bg-mint-500/12 text-mint-600",    label: "Randevu" },
  offer:       { icon: Tag,           dot: "bg-amber-500",  tone: "bg-amber-400/15 text-amber-600",  label: "Teklif" },
  contract:    { icon: FileSignature, dot: "bg-danger-500", tone: "bg-danger-500/10 text-danger-500", label: "Sözleşme" },
  task:        { icon: CheckCircle2,  dot: "bg-mint-600",   tone: "bg-mint-500/10 text-mint-600",    label: "Görev" },
  created:     { icon: Sparkles,      dot: "bg-ink-950/40", tone: "bg-ink-950/8 text-text-muted",    label: "Kayıt" },
};

/* Filtre çipleri — URL'siz basit client state. "Görüşme" çağrı + iletişim kaydını kapsar. */
const FILTERS = [
  { id: "all",         label: "Tümü",     kinds: null },
  { id: "gorusme",     label: "Görüşme",  kinds: ["call", "comm"] },
  { id: "randevu",     label: "Randevu",  kinds: ["appointment"] },
  { id: "teklif",      label: "Teklif",   kinds: ["offer"] },
  { id: "sozlesme",    label: "Sözleşme", kinds: ["contract"] },
  { id: "gorev",       label: "Görev",    kinds: ["task"] },
] as const;

type FilterId = (typeof FILTERS)[number]["id"];

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
  const m = Math.floor(diff / 60_000);
  if (m < 1)  return "az önce";
  if (m < 60) return `${m} dk önce`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} sa önce`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} gün önce`;
  return new Date(iso).toLocaleDateString("tr-TR");
}

/** Gün ayırıcı etiketi: Bugün / Dün / "12 Mart 2026" */
function dayLabel(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOf(today) - startOf(date)) / 86_400_000);
  if (dayDiff === 0) return "Bugün";
  if (dayDiff === 1) return "Dün";
  return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

const MAX_ITEMS = 100;

export function CustomerTimelineTab({ items }: { items: TimelineItem[] }) {
  const [filter, setFilter] = useState<FilterId>("all");

  const hasMore = items.length > MAX_ITEMS;
  const capped = hasMore ? items.slice(0, MAX_ITEMS) : items;

  const activeKinds = FILTERS.find((f) => f.id === filter)?.kinds ?? null;
  const visible = activeKinds
    ? capped.filter((i) => (activeKinds as readonly string[]).includes(i.kind))
    : capped;

  // Gün gruplarına böl (öğeler zaten yeni→eski sıralı gelir)
  const groups: { label: string; rows: TimelineItem[] }[] = [];
  for (const item of visible) {
    const label = dayLabel(item.time);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.rows.push(item);
    else groups.push({ label, rows: [item] });
  }

  return (
    <section className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
          <History className="h-4 w-4 text-brand-600" /> Zaman tüneli
        </h2>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tip filtresi">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
              className={`focus-ring rounded-full border px-3 py-1 text-[11px] font-semibold transition ${
                filter === f.id
                  ? "border-brand-600 bg-brand-600 text-white"
                  : "border-line bg-canvas text-text-muted hover:border-brand-400"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="mt-4 rounded-[12px] border border-dashed border-line-strong px-4 py-8 text-center text-sm text-text-muted">
          {filter === "all" ? "Henüz zaman tüneli kaydı yok." : "Bu tipte kayıt bulunamadı."}
        </p>
      ) : (
        <div className="mt-4 space-y-5">
          {groups.map((g) => (
            <div key={g.label}>
              <div className="flex items-center gap-3">
                <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-text-faint">{g.label}</span>
                <span className="h-px flex-1 bg-line" />
              </div>
              <div className="mt-2 space-y-2">
                {g.rows.map((item) => {
                  const meta = KIND_META[item.kind];
                  const Icon = meta.icon;
                  const inner = (
                    <>
                      <span className={`mt-3 h-2 w-2 shrink-0 rounded-full ${meta.dot}`} aria-hidden />
                      <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[9px] ${meta.tone}`}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-ink-950">{item.title}</span>
                        {item.sub ? <span className="block truncate text-xs text-text-muted">{item.sub}</span> : null}
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-text-faint">
                        {relTime(item.time)}
                        {item.href ? <ArrowUpRight className="hover-action h-3.5 w-3.5 opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" /> : null}
                      </span>
                    </>
                  );
                  const cls = "flex items-start gap-3 rounded-[12px] border border-line bg-canvas/50 px-3 py-3";
                  return item.href ? (
                    <Link key={item.key} href={item.href} className={`focus-ring group ${cls} transition hover:border-brand-300`}>
                      {inner}
                    </Link>
                  ) : (
                    <div key={item.key} className={cls}>{inner}</div>
                  );
                })}
              </div>
            </div>
          ))}
          {hasMore ? (
            <p className="rounded-[12px] border border-dashed border-line px-4 py-3 text-center text-xs text-text-faint">
              Son {MAX_ITEMS} kayıt gösteriliyor — daha eski kayıtlar ilgili sekmelerde.
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
