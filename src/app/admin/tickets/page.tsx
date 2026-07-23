import Link from "next/link";
import { AlertTriangle, ArrowUpRight, LifeBuoy, Siren } from "lucide-react";
import { setTicketStatus } from "@/app/actions/tickets";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import type { CSSProperties } from "react";

const RING_C = 2 * Math.PI * 42;

const statusLabel: Record<string, string> = {
  open: "Açık",
  in_progress: "İşleniyor",
  waiting: "Yanıt bekliyor",
  resolved: "Çözüldü",
  closed: "Kapalı",
};

const statusColor: Record<string, string> = {
  open: "var(--brand-500)",
  in_progress: "var(--cyan-400)",
  waiting: "var(--amber-400)",
  resolved: "var(--mint-500)",
  closed: "rgba(10,18,36,0.25)",
};

const priorityCls: Record<string, string> = {
  low: "text-text-muted",
  normal: "text-brand-600",
  high: "text-amber-600",
  urgent: "text-danger-500",
};

const priorityLabel: Record<string, string> = {
  low: "Düşük",
  normal: "Normal",
  high: "Yüksek",
  urgent: "Acil",
};

const categoryLabel: Record<string, string> = {
  general: "Genel",
  billing: "Fatura",
  bug: "Hata",
  feature: "Özellik isteği",
  compliance: "Uyum",
  onboarding: "Kurulum",
};

const priorityColor: Record<string, string> = {
  low: "rgba(10,18,36,0.2)",
  normal: "var(--brand-500)",
  high: "var(--amber-400)",
  urgent: "var(--danger-500)",
};

type Rel = { name?: string } | { name?: string }[] | null;
function nameOf(v: Rel) {
  if (!v) return "—";
  return Array.isArray(v) ? (v[0]?.name ?? "—") : (v.name ?? "—");
}

export default async function AdminTicketsPage() {
  await requirePlatformModule("tickets");
  const admin = createAdminClient();

  const { data } = await admin
    .from("support_tickets")
    .select("id, subject, body, category, priority, status, created_at, tenant:tenants(name)")
    .order("created_at", { ascending: false })
    .limit(200);

  const rows = data ?? [];
  const open = rows.filter((t) => ["open", "in_progress", "waiting"].includes(t.status)).length;
  const urgent = rows.filter((t) => t.priority === "urgent" && !["resolved", "closed"].includes(t.status)).length;

  const statusKeys = ["open", "in_progress", "waiting", "resolved", "closed"] as const;
  const statusCounts = statusKeys.map((k) => ({
    key: k,
    label: statusLabel[k],
    count: rows.filter((t) => t.status === k).length,
    color: statusColor[k],
  }));
  const total = Math.max(1, rows.length);
  let offset = 0;
  const arcs = statusCounts.map((s) => {
    const len = (s.count / total) * RING_C;
    const item = { ...s, dash: len, offset };
    offset += len;
    return item;
  });

  const priorityKeys = ["urgent", "high", "normal", "low"] as const;
  const priorityCounts = priorityKeys.map((k) => ({
    key: k,
    count: rows.filter((t) => t.priority === k).length,
    color: priorityColor[k],
  }));
  const maxPri = Math.max(1, ...priorityCounts.map((p) => p.count));

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-12 -top-14 h-52 w-52 rounded-full bg-danger-500/20 blur-[90px]" />
        <div className="relative grid gap-6 lg:grid-cols-[1.15fr_1fr] lg:items-center">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-amber-400">
              <LifeBuoy className="h-4 w-4" /> Destek operasyonu
            </span>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white">Destek talebi kuyruğu</h1>
            <p className="mt-1 text-sm text-white/60">{rows.length} talep · {open} açık/bekleyen</p>
            <div className="mt-5 grid grid-cols-3 gap-3">
              <div className="rounded-[14px] border border-white/10 bg-white/5 p-3">
                <p className="font-display text-xl font-extrabold">{rows.length}</p>
                <p className="text-[10px] text-white/45">Toplam</p>
              </div>
              <div className="rounded-[14px] border border-white/10 bg-white/5 p-3">
                <p className="font-display text-xl font-extrabold text-amber-300">{open}</p>
                <p className="text-[10px] text-white/45">Açık kuyruk</p>
              </div>
              <div className="rounded-[14px] border border-white/10 bg-white/5 p-3">
                <p className="flex items-center gap-1.5 font-display text-xl font-extrabold text-danger-400">
                  {urgent > 0 ? <span className="status-pulse h-2 w-2 rounded-full bg-danger-400" /> : null}
                  {urgent}
                </p>
                <p className="text-[10px] text-white/45">Acil</p>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[16px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-white/45">Durum</p>
              <div className="relative mx-auto mt-3 grid h-24 w-24 place-items-center">
                <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
                  <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" />
                  {arcs.filter((a) => a.count > 0).map((a) => (
                    <circle
                      key={a.key}
                      cx="50"
                      cy="50"
                      r="42"
                      fill="none"
                      stroke={a.color}
                      strokeWidth="10"
                      strokeDasharray={`${a.dash} ${RING_C - a.dash}`}
                      strokeDashoffset={-a.offset}
                      className="ring-sweep"
                      style={{ "--circ": RING_C, "--dash": RING_C - a.dash } as CSSProperties}
                    />
                  ))}
                </svg>
                <div className="absolute text-center">
                  <p className="font-display text-lg font-extrabold">{open}</p>
                  <p className="text-[8px] text-white/40">açık</p>
                </div>
              </div>
            </div>
            <div className="rounded-[16px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur">
              <p className="mb-3 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-white/45">
                <Siren className="h-3 w-3 text-danger-400" /> Öncelik
              </p>
              <div className="flex h-24 items-end gap-2">
                {priorityCounts.map((p, i) => (
                  <div key={p.key} className="flex flex-1 flex-col items-center gap-1">
                    <span className="text-[10px] font-bold text-white/80">{p.count}</span>
                    <div
                      className="bar-live w-full max-w-[22px] rounded-t-[4px]"
                      style={{
                        height: `${Math.max((p.count / maxPri) * 100, 8)}%`,
                        background: p.color,
                        animationDelay: `${i * 0.1}s`,
                      }}
                    />
                    <span className="text-[8px] capitalize text-white/35">{p.key}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="overflow-hidden rounded-[20px] border border-line bg-surface">
        {rows.length === 0 ? (
          <p className="px-5 py-14 text-center text-sm text-text-muted">Henüz destek talebi yok.</p>
        ) : (
          <div className="divide-y divide-line">
            {rows.map((t) => (
              <article key={t.id} className="grid gap-3 px-5 py-4 transition hover:bg-brand-600/[0.02] lg:grid-cols-[1.5fr_1fr_auto] lg:items-start">
                <div>
                  <div className="flex items-center gap-2">
                    {t.priority === "urgent" ? <AlertTriangle className="h-3.5 w-3.5 text-danger-500" /> : null}
                    <Link href={`/admin/tickets/${t.id}`} className="text-sm font-semibold text-ink-950 transition hover:text-brand-600">
                      {t.subject}
                    </Link>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-text-muted">{t.body}</p>
                  <p className="mt-2 text-[11px] text-text-faint">
                    {nameOf(t.tenant as Rel)} · {categoryLabel[t.category] ?? t.category} ·{" "}
                    <span className={`font-semibold ${priorityCls[t.priority] ?? ""}`}>{priorityLabel[t.priority] ?? t.priority}</span> ·{" "}
                    {new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(t.created_at))}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-brand-600/10 px-2.5 py-1 text-[10px] font-bold text-brand-600">
                    {statusLabel[t.status] ?? t.status}
                  </span>
                  <Link
                    href={`/admin/tickets/${t.id}`}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 hover:underline"
                  >
                    Konuşma <ArrowUpRight className="h-3 w-3" />
                  </Link>
                </div>
                <form action={setTicketStatus} className="flex items-center gap-2">
                  <input type="hidden" name="id" value={t.id} />
                  <select name="status" defaultValue={t.status} className="rounded-[9px] border border-line bg-canvas px-2 py-1.5 text-xs font-semibold outline-none focus:border-brand-400">
                    {Object.entries(statusLabel).map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                  <button type="submit" className="rounded-[9px] bg-ink-950 px-3 py-1.5 text-xs font-semibold text-white">
                    Güncelle
                  </button>
                </form>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
