import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, LifeBuoy, Shield } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { TicketReplyForm } from "../ticket-reply-form";
import { setTicketStatusTenantAction } from "@/app/actions/tickets";

const statusLabel: Record<string, string> = {
  open: "Açık",
  in_progress: "İşleniyor",
  waiting: "Yanıt bekleniyor",
  resolved: "Çözüldü",
  closed: "Kapalı",
};

const statusCls: Record<string, string> = {
  open: "bg-brand-600/10 text-brand-600",
  in_progress: "bg-cyan-400/12 text-cyan-600",
  waiting: "bg-amber-400/15 text-amber-600",
  resolved: "bg-mint-500/12 text-mint-600",
  closed: "bg-ink-950/8 text-text-muted",
};

const catLabel: Record<string, string> = {
  general: "Genel",
  billing: "Fatura",
  bug: "Hata",
  feature: "Özellik",
  compliance: "Uyum",
  onboarding: "Kurulum",
};

function dt(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

export default async function SupportTicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModulePage("support");
  const { id } = await params;
  const supabase = await createClient();

  const { data: ticket } = await supabase
    .from("support_tickets")
    .select("id, subject, body, category, priority, status, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();

  if (!ticket) notFound();

  const { data: messages } = await supabase
    .from("support_ticket_messages")
    .select("id, body, author_kind, author_user_id, created_at")
    .eq("ticket_id", id)
    .order("created_at", { ascending: true });

  const rows = messages ?? [];
  const authorIds = [...new Set(rows.map((m) => m.author_user_id).filter(Boolean))] as string[];

  const [{ data: profiles }, { data: staffRows }] = await Promise.all([
    authorIds.length
      ? supabase.from("profiles").select("id, full_name").in("id", authorIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    authorIds.length
      ? supabase.from("platform_staff").select("id, full_name").in("id", authorIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
  ]);

  const nameMap = new Map<string, string>();
  (profiles ?? []).forEach((p) => nameMap.set(p.id, p.full_name));
  (staffRows ?? []).forEach((s) => nameMap.set(s.id, s.full_name));

  const closed = ticket.status === "closed" || ticket.status === "resolved";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/app/destek" className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted transition hover:text-brand-600">
        <ArrowLeft className="h-3.5 w-3.5" /> Destek taleplerine dön
      </Link>

      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="relative">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${statusCls[ticket.status] ?? statusCls.open}`}>
              {statusLabel[ticket.status] ?? ticket.status}
            </span>
            <span className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-bold text-white/70">
              {catLabel[ticket.category] ?? ticket.category}
            </span>
            <span className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-bold text-amber-300">
              {ticket.priority}
            </span>
          </div>
          <h1 className="mt-3 font-display text-2xl font-extrabold text-white">{ticket.subject}</h1>
          <p className="mt-1 text-xs text-white/45">
            Açılış {dt(ticket.created_at)} · Son güncelleme {dt(ticket.updated_at)}
          </p>
        </div>
      </section>

      <section className="space-y-3">
        {rows.map((m) => {
          const isStaff = m.author_kind === "staff";
          const isSystem = m.author_kind === "system";
          const name =
            isSystem
              ? "Sistem"
              : nameMap.get(m.author_user_id ?? "") ?? (isStaff ? "EmlakSoft Destek" : "Ofis");
          return (
            <article
              key={m.id}
              className={`rounded-[16px] border p-4 ${
                isStaff
                  ? "border-amber-400/25 bg-amber-400/5"
                  : isSystem
                    ? "border-line bg-canvas/60"
                    : "border-line bg-surface"
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
                {isStaff ? (
                  <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-bold text-amber-600">
                    EmlakSoft
                  </span>
                ) : null}
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink-950/90">{m.body}</p>
            </article>
          );
        })}
        {rows.length === 0 ? (
          <p className="rounded-[16px] border border-dashed border-line px-4 py-10 text-center text-sm text-text-muted">
            Henüz mesaj yok.
          </p>
        ) : null}
      </section>

      {closed ? (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-line bg-canvas/60 px-5 py-4">
          <p className="text-sm text-text-muted">
            Bu talep {ticket.status === "closed" ? "kapatıldı" : "çözüldü olarak işaretlendi"}. Sorun devam ediyorsa yeniden açabilirsiniz.
          </p>
          <form action={setTicketStatusTenantAction}>
            <input type="hidden" name="id" value={ticket.id} />
            <input type="hidden" name="status" value="open" />
            <button type="submit" className="rounded-[10px] border border-brand-300 bg-brand-600/5 px-4 py-2 text-sm font-semibold text-brand-600 transition hover:bg-brand-600/10">
              Yeniden aç
            </button>
          </form>
        </section>
      ) : (
        <section className="rounded-[20px] border border-line bg-surface p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display font-bold text-ink-950">Yanıt yaz</h2>
              <p className="mt-1 text-xs text-text-muted">Mesajınız EmlakSoft destek ekibine iletilir.</p>
            </div>
            <form action={setTicketStatusTenantAction}>
              <input type="hidden" name="id" value={ticket.id} />
              <input type="hidden" name="status" value="closed" />
              <button type="submit" className="rounded-[10px] border border-line px-3.5 py-2 text-xs font-semibold text-text-muted transition hover:border-danger-500/40 hover:text-danger-500">
                Talebi kapat
              </button>
            </form>
          </div>
          <div className="mt-4">
            <TicketReplyForm ticketId={ticket.id} disabled={closed} />
          </div>
        </section>
      )}
    </div>
  );
}
