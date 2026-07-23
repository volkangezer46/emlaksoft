import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2, LifeBuoy, Shield } from "lucide-react";
import { setTicketStatus } from "@/app/actions/tickets";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { StaffReplyForm } from "../staff-reply-form";

const statusLabel: Record<string, string> = {
  open: "Açık",
  in_progress: "İşleniyor",
  waiting: "Yanıt bekliyor",
  resolved: "Çözüldü",
  closed: "Kapalı",
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

type Rel = { name?: string } | { name?: string }[] | null;
function nameOf(v: Rel) {
  if (!v) return "—";
  return Array.isArray(v) ? (v[0]?.name ?? "—") : (v.name ?? "—");
}

function dt(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

export default async function AdminTicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePlatformModule("tickets");
  const { id } = await params;
  const admin = createAdminClient();

  const { data: ticket } = await admin
    .from("support_tickets")
    .select("id, subject, body, category, priority, status, created_at, updated_at, tenant:tenants(name)")
    .eq("id", id)
    .maybeSingle();

  if (!ticket) notFound();

  const { data: messages } = await admin
    .from("support_ticket_messages")
    .select("id, body, author_kind, author_user_id, created_at")
    .eq("ticket_id", id)
    .order("created_at", { ascending: true });

  const rows = messages ?? [];
  const authorIds = [...new Set(rows.map((m) => m.author_user_id).filter(Boolean))] as string[];

  const [{ data: profiles }, { data: staffRows }] = await Promise.all([
    authorIds.length
      ? admin.from("profiles").select("id, full_name").in("id", authorIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    authorIds.length
      ? admin.from("platform_staff").select("id, full_name").in("id", authorIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
  ]);

  const nameMap = new Map<string, string>();
  (profiles ?? []).forEach((p) => nameMap.set(p.id, p.full_name));
  (staffRows ?? []).forEach((s) => nameMap.set(s.id, s.full_name));

  const closed = ticket.status === "closed";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/admin/tickets" className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted transition hover:text-amber-600">
        <ArrowLeft className="h-3.5 w-3.5" /> Destek kuyruğuna dön
      </Link>

      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="relative grid gap-4 lg:grid-cols-[1.4fr_auto] lg:items-start">
          <div>
            <p className="flex items-center gap-2 text-xs text-white/50">
              <Building2 className="h-3.5 w-3.5 text-amber-400" />
              {nameOf(ticket.tenant as Rel)} · {categoryLabel[ticket.category] ?? ticket.category} ·{" "}
              <span className={priorityCls[ticket.priority] ?? ""}>{priorityLabel[ticket.priority] ?? ticket.priority}</span>
            </p>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white">{ticket.subject}</h1>
            <p className="mt-1 text-xs text-white/45">
              {dt(ticket.created_at)} · durum: {statusLabel[ticket.status] ?? ticket.status}
            </p>
          </div>
          <form action={setTicketStatus} className="flex flex-wrap items-center gap-2 rounded-[14px] border border-white/10 bg-white/5 p-3">
            <input type="hidden" name="id" value={ticket.id} />
            <select
              name="status"
              defaultValue={ticket.status}
              className="rounded-[9px] border border-white/15 bg-ink-950/40 px-2 py-1.5 text-xs font-semibold text-white outline-none"
            >
              {Object.entries(statusLabel).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
            <button type="submit" className="rounded-[9px] bg-amber-400 px-3 py-1.5 text-xs font-bold text-ink-950">
              Güncelle
            </button>
          </form>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_.9fr]">
        <section className="space-y-3">
          {rows.map((m) => {
            const isStaff = m.author_kind === "staff";
            const name =
              nameMap.get(m.author_user_id ?? "") ??
              (isStaff ? "EmlakSoft Destek" : "Ofis kullanıcısı");
            return (
              <article
                key={m.id}
                className={`rounded-[16px] border p-4 ${
                  isStaff ? "border-amber-400/30 bg-amber-400/5" : "border-line bg-surface"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`grid h-8 w-8 place-items-center rounded-[10px] ${
                      isStaff ? "bg-amber-400/15 text-amber-600" : "bg-brand-600/10 text-brand-600"
                    }`}
                  >
                    {isStaff ? <Shield className="h-4 w-4" /> : <LifeBuoy className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink-950">{name}</p>
                    <p className="text-[11px] text-text-faint">{dt(m.created_at)}</p>
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wide text-text-faint">
                    {isStaff ? "Personel" : "Ofis"}
                  </span>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink-950/90">{m.body}</p>
              </article>
            );
          })}
        </section>

        <section className="h-fit rounded-[20px] border border-line bg-surface p-5">
          <h2 className="font-display font-bold text-ink-950">Personel yanıtı</h2>
          <p className="mt-1 text-xs text-text-muted">Yanıt sonrası talep “yanıt bekliyor” durumuna alınır.</p>
          <div className="mt-4">
            <StaffReplyForm ticketId={ticket.id} disabled={closed} />
          </div>
        </section>
      </div>
    </div>
  );
}
