import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Activity,
  ArrowLeft,
  Building2,
  CheckCircle2,
  Hash,
  History,
  LifeBuoy,
  MessageSquareText,
  ShieldCheck,
  Timer,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { cn } from "@/lib/utils";
import { TicketReplyForm } from "../ticket-reply-form";
import {
  TicketAttachmentList,
  type TicketAttachmentDisplay,
} from "./ticket-attachment-list";
import { TicketCsatForm } from "./ticket-csat-form";
import { TenantTicketControls } from "./tenant-ticket-controls";
import { TicketThread, type TicketMessage } from "./ticket-thread";

const statusLabel: Record<string, string> = {
  open: "Açık",
  in_progress: "İşleniyor",
  waiting: "Yanıt bekleniyor",
  resolved: "Çözüldü",
  closed: "Kapalı",
};
const statusCls: Record<string, string> = {
  open: "bg-brand-500/20 text-cyan-100",
  in_progress: "bg-cyan-400/20 text-cyan-100",
  waiting: "bg-amber-400/20 text-amber-100",
  resolved: "bg-mint-500/20 text-emerald-100",
  closed: "bg-white/10 text-white/65",
};
const categoryLabel: Record<string, string> = {
  general: "Genel",
  billing: "Fatura",
  bug: "Hata",
  feature: "Özellik isteği",
  compliance: "Uyum",
  onboarding: "Kurulum",
};
const priorityLabel: Record<string, string> = { low: "Düşük", normal: "Normal", high: "Yüksek", urgent: "Acil" };
const lifecycleLabel: Record<string, string> = {
  create: "Talep oluşturuldu",
  reply: "Konuşmaya mesaj eklendi",
  status: "Talep durumu güncellendi",
  assign: "Destek sorumlusu güncellendi",
  priority: "Öncelik güncellendi",
  category: "Kategori güncellendi",
  "attachment.uploaded": "Dosya eklendi",
  "attachment.deleted": "Dosya silindi",
};

type PublicEvent = {
  id: string;
  actor_kind: string;
  event_type: string;
  created_at: string;
};

function dt(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" }).format(new Date(iso));
}

function relativeTime(iso: string | null | undefined, done = false) {
  if (!iso) return done ? "Tamamlandı" : "Planlanıyor";
  if (done) return "Tamamlandı";
  const diff = new Date(iso).getTime() - Date.now();
  const minutes = Math.max(1, Math.round(Math.abs(diff) / 60_000));
  const amount = minutes >= 1440 ? `${Math.round(minutes / 1440)} gün` : minutes >= 60 ? `${Math.round(minutes / 60)} saat` : `${minutes} dakika`;
  return diff < 0 ? `${amount} önce doldu` : `${amount} kaldı`;
}

export default async function SupportTicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const gate = await requireModulePage("support");
  const { id } = await params;
  const supabase = await createClient();

  const [ticketResult, messagesResult, eventsResult, attachmentsResult, csatResult] = await Promise.all([
    supabase
      .from("support_tickets")
      .select("id, ticket_no, subject, body, category, priority, status, created_by, created_by_staff_id, created_at, updated_at, source, first_response_due_at, resolution_due_at, first_response_at, last_activity_at, resolved_at, closed_at, reopened_at, reopen_count, resolution_code, resolution_summary, version")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("support_ticket_messages")
      .select("id, body, author_kind, author_user_id, visibility, created_at")
      .eq("ticket_id", id)
      .eq("visibility", "public")
      .order("created_at", { ascending: true }),
    supabase
      .from("support_ticket_events")
      .select("id, actor_kind, event_type, created_at")
      .eq("ticket_id", id)
      .eq("visibility", "public")
      .order("created_at", { ascending: false })
      .limit(12),
    supabase
      .from("support_ticket_attachments")
      .select("id, message_id, uploaded_by, uploaded_by_kind, visibility, file_name, mime_type, file_size, scan_status, created_at")
      .eq("ticket_id", id)
      .eq("visibility", "public")
      .eq("scan_status", "verified")
      .is("deleted_at", null)
      .order("created_at", { ascending: true }),
    supabase
      .from("support_ticket_csat")
      .select("score, comment")
      .eq("ticket_id", id)
      .maybeSingle(),
  ]);

  if (ticketResult.error) throw new Error(`Destek talebi yüklenemedi: ${ticketResult.error.message}`);
  if (!ticketResult.data) notFound();
  if (messagesResult.error) throw new Error(`Destek konuşması yüklenemedi: ${messagesResult.error.message}`);
  if (eventsResult.error) throw new Error(`Talep geçmişi yüklenemedi: ${eventsResult.error.message}`);
  if (attachmentsResult.error) throw new Error(`Talep dosyaları yüklenemedi: ${attachmentsResult.error.message}`);
  if (csatResult.error) throw new Error(`Destek değerlendirmesi yüklenemedi: ${csatResult.error.message}`);

  const ticket = ticketResult.data;
  const rawMessages = (messagesResult.data ?? []) as TicketMessage[];
  const firstMessage = rawMessages[0];
  const hasOpeningMessage = Boolean(
    firstMessage &&
      firstMessage.body.trim() === ticket.body?.trim() &&
      Math.abs(new Date(firstMessage.created_at).getTime() - new Date(ticket.created_at).getTime()) <= 5 * 60_000,
  );
  const openingAuthorKind = ticket.created_by ? "tenant" : ticket.created_by_staff_id ? "staff" : "system";
  const openingAuthorId = ticket.created_by ?? ticket.created_by_staff_id ?? null;
  const rows: TicketMessage[] = ticket.body?.trim() && !hasOpeningMessage
    ? [{ id: `opening-${ticket.id}`, body: ticket.body, author_kind: openingAuthorKind, author_user_id: openingAuthorId, visibility: "public", created_at: ticket.created_at }, ...rawMessages]
    : rawMessages;
  const attachments = (attachmentsResult.data ?? []) as TicketAttachmentDisplay[];
  const ticketAttachments = attachments.filter((attachment) => !attachment.message_id);
  const authorIds = [...new Set(rows.map((message) => message.author_user_id).filter(Boolean))] as string[];
  const [profilesResult, staffResult] = await Promise.all([
    authorIds.length ? supabase.from("profiles").select("id, full_name").in("id", authorIds) : Promise.resolve({ data: [], error: null }),
    authorIds.length ? supabase.from("platform_staff").select("id, full_name").in("id", authorIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (profilesResult.error) throw new Error(`Konuşma katılımcıları yüklenemedi: ${profilesResult.error.message}`);
  if (staffResult.error) throw new Error(`Destek kimliği yüklenemedi: ${staffResult.error.message}`);

  const names: Record<string, string> = {};
  for (const profile of profilesResult.data ?? []) names[profile.id] = profile.full_name;
  for (const staff of staffResult.data ?? []) names[staff.id] = staff.full_name;

  const terminal = ticket.status === "closed" || ticket.status === "resolved";
  const events = (eventsResult.data ?? []) as PublicEvent[];
  const firstResponseDone = Boolean(ticket.first_response_at);
  const updatedAt = ticket.last_activity_at ?? ticket.updated_at;

  return (
    <div className="mx-auto max-w-6xl space-y-4 pb-10">
      <Link href="/app/destek" className="focus-ring inline-flex items-center gap-1.5 rounded-md text-xs font-semibold text-text-muted transition hover:text-brand-600">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Destek taleplerine dön
      </Link>

      <header className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-5 text-white sm:p-6">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-cyan-400/15 blur-[75px]" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold text-white/50">
              <span className="inline-flex items-center gap-1"><Hash className="h-3 w-3" />{ticket.ticket_no ?? ticket.id.slice(0, 8).toUpperCase()}</span>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1"><Building2 className="h-3 w-3" />EmlakSoft Destek</span>
            </div>
            <h1 className="mt-2 max-w-3xl text-balance font-display text-2xl font-extrabold tracking-[-0.02em] text-white sm:text-3xl">{ticket.subject}</h1>
            <p className="mt-2 text-xs text-white/45">Açılış {dt(ticket.created_at)} · Son hareket {dt(updatedAt)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-bold", statusCls[ticket.status] ?? statusCls.open)}>{statusLabel[ticket.status] ?? ticket.status}</span>
            <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white/70">{categoryLabel[ticket.category] ?? ticket.category}</span>
            <span className="rounded-full bg-amber-400/15 px-2.5 py-1 text-[11px] font-bold text-amber-200">{priorityLabel[ticket.priority] ?? ticket.priority}</span>
          </div>
        </div>

        <div className="relative mt-5 grid overflow-hidden rounded-[14px] border border-white/10 bg-white/[0.055] sm:grid-cols-3">
          {[
            { icon: Timer, label: "İlk yanıt", value: relativeTime(ticket.first_response_due_at, firstResponseDone), detail: firstResponseDone ? dt(ticket.first_response_at) : dt(ticket.first_response_due_at) },
            { icon: ShieldCheck, label: "Çözüm hedefi", value: relativeTime(ticket.resolution_due_at, terminal), detail: dt(ticket.resolution_due_at) },
            { icon: MessageSquareText, label: "Konuşma", value: `${rows.length} mesaj`, detail: `${attachments.length} güvenli dosya` },
          ].map((metric) => (
            <div key={metric.label} className="flex items-center gap-3 border-white/10 p-3.5 sm:[&:not(:first-child)]:border-l">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-white/10 text-cyan-200"><metric.icon className="h-4 w-4" /></span>
              <span className="min-w-0"><span className="block text-[10px] font-semibold uppercase tracking-[0.06em] text-white/40">{metric.label}</span><span className="block truncate text-sm font-bold text-white">{metric.value}</span><span className="block truncate text-[10px] text-white/40">{metric.detail}</span></span>
            </div>
          ))}
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <main className="min-w-0 space-y-4">
          {ticketAttachments.length ? <section className="rounded-[16px] border border-line bg-surface p-4"><TicketAttachmentList attachments={ticketAttachments} currentUserId={gate.userId} label="Talep ekleri" /></section> : null}

          <TicketThread ticketId={ticket.id} initial={rows} names={names} attachments={attachments} audience="tenant" currentUserId={gate.userId} />

          {!terminal ? (
            <section className="rounded-[18px] border border-line bg-surface p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h2 className="font-display font-bold text-ink-950">Destek ekibine yanıt ver</h2><p className="mt-1 text-xs text-text-muted">Ayrıntı ve güvenli dosya ekleyerek konuşmayı sürdürebilirsiniz.</p></div>
                <TenantTicketControls ticketId={ticket.id} status={ticket.status} version={ticket.version} />
              </div>
              <div className="mt-4"><TicketReplyForm ticketId={ticket.id} version={ticket.version} /></div>
            </section>
          ) : (
            <section className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-line bg-canvas/60 px-5 py-4">
              <div><p className="text-sm font-semibold text-ink-950">Bu talep {ticket.status === "closed" ? "kapatıldı" : "çözüldü"}.</p><p className="mt-0.5 text-xs text-text-muted">Sorun devam ediyorsa talebi yeniden açıp konuşmayı sürdürebilirsiniz.</p></div>
              <TenantTicketControls ticketId={ticket.id} status={ticket.status} version={ticket.version} />
            </section>
          )}
        </main>

        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          {ticket.resolution_code || ticket.resolution_summary ? (
            <section className="rounded-[16px] border border-mint-500/25 bg-mint-500/[0.06] p-4">
              <h2 className="flex items-center gap-2 font-display text-sm font-bold text-mint-800"><CheckCircle2 className="h-4 w-4" />Çözüm özeti</h2>
              {ticket.resolution_summary ? <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-ink-950/80">{ticket.resolution_summary}</p> : <p className="mt-2 text-xs text-text-muted">Talep sonuçlandırıldı.</p>}
              <p className="mt-2 text-[10px] text-text-faint">{dt(ticket.resolved_at ?? ticket.closed_at)}</p>
            </section>
          ) : null}

          {terminal ? <TicketCsatForm ticketId={ticket.id} existing={csatResult.data} /> : null}

          <section className="rounded-[16px] border border-line bg-surface p-4">
            <h2 className="flex items-center gap-2 font-display text-sm font-bold text-ink-950"><History className="h-4 w-4 text-brand-600" />Talep geçmişi</h2>
            <ol className="mt-3 space-y-0">
              {events.map((event, index) => (
                <li key={event.id} className="relative flex gap-2.5 pb-3 last:pb-0">
                  {index < events.length - 1 ? <span className="absolute bottom-0 left-[13px] top-7 w-px bg-line" aria-hidden /> : null}
                  <span className="relative z-[1] grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-600/10 text-brand-700"><Activity className="h-3 w-3" /></span>
                  <div className="min-w-0 pt-0.5"><p className="text-xs font-semibold text-ink-950">{lifecycleLabel[event.event_type] ?? "Talep güncellendi"}</p><p className="mt-0.5 text-[10px] text-text-faint">{dt(event.created_at)}</p></div>
                </li>
              ))}
              {events.length === 0 ? <li className="rounded-[10px] border border-dashed border-line p-3 text-center text-xs text-text-faint">Geçmiş kaydı henüz yok.</li> : null}
            </ol>
          </section>

          <section className="rounded-[16px] border border-line bg-canvas/65 p-4">
            <p className="flex items-center gap-2 text-xs font-bold text-ink-950"><LifeBuoy className="h-4 w-4 text-brand-600" />Güvenli destek kanalı</p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-text-muted">Mesajlar yalnız yetkili ofis kullanıcıları ve EmlakSoft destek ekibi tarafından görülebilir. Dosyalar private depoda doğrulanır.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
