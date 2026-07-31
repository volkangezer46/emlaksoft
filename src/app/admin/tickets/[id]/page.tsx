import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2, Clock, Plus, Trash2, UserRound } from "lucide-react";
import { createTicketMacroAction, deleteTicketMacroAction } from "@/app/actions/admin-ticket-ops";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { StaffReplyForm } from "../staff-reply-form";
import { TicketDetailControls } from "./ticket-detail-controls";
import { slaStateOf } from "../sla";
import { SlaBadge } from "../sla-badge";

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
  closed: "rgba(10,18,36,0.28)",
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

/** Baş harf rozeti — konuşma katılımcıları ve ofis kimliği için tutarlı avatar. */
function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

/** Avatar rozeti — renk tonu role göre (ofis=brand, personel=amber). */
function Avatar({ name, tone, size = "md" }: { name: string; tone: "brand" | "amber"; size?: "sm" | "md" }) {
  const toneCls = tone === "amber" ? "bg-amber-400/15 text-amber-700" : "bg-brand-600/10 text-brand-700";
  const sizeCls = size === "sm" ? "h-7 w-7 text-[10px]" : "h-9 w-9 text-xs";
  return (
    <span className={cn("grid shrink-0 place-items-center rounded-full font-bold", toneCls, sizeCls)} aria-hidden>
      {initials(name)}
    </span>
  );
}

/** Yan panel özellik satırı. */
function Prop({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <dt className="shrink-0 text-xs text-text-muted">{label}</dt>
      <dd className="min-w-0 text-right text-xs font-semibold text-ink-950">{children}</dd>
    </div>
  );
}

export default async function AdminTicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const viewer = await requirePlatformModule("tickets");
  const { id } = await params;
  const admin = createAdminClient();

  // ticket, messages, personel listesi ve makrolar yalnızca params id'ye bağlı → paralel
  const [{ data: ticket }, { data: messages }, { data: staffList }, { data: macroRows }] = await Promise.all([
    admin
      .from("support_tickets")
      .select("id, subject, body, category, priority, status, created_at, updated_at, tenant_id, assigned_staff_id, tenant:tenants(name)")
      .eq("id", id)
      .maybeSingle(),
    admin
      .from("support_ticket_messages")
      .select("id, body, author_kind, author_user_id, created_at")
      .eq("ticket_id", id)
      .order("created_at", { ascending: true }),
    admin.from("platform_staff").select("id, full_name").eq("is_active", true).order("full_name"),
    admin.from("ticket_macros").select("id, title, body").order("title"),
  ]);

  if (!ticket) notFound();

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
  const staff = staffList ?? [];
  const macros = macroRows ?? [];
  const isSuperAdmin = viewer.role === "super_admin";
  const assignedName = ticket.assigned_staff_id
    ? (staff.find((s) => s.id === ticket.assigned_staff_id)?.full_name ?? nameMap.get(ticket.assigned_staff_id) ?? "Personel")
    : null;
  const sla = slaStateOf({
    status: ticket.status,
    createdAt: ticket.created_at,
    hasStaffReply: rows.some((m) => m.author_kind === "staff"),
  });
  const statusOptions = Object.entries(statusLabel).map(([value, label]) => ({ value, label }));
  const replyCount = rows.filter((m) => m.author_kind === "staff").length;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Link href="/admin/tickets" className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted transition hover:text-brand-600">
        <ArrowLeft className="h-3.5 w-3.5" /> Destek kuyruğuna dön
      </Link>

      {/* Kompakt profesyonel başlık */}
      <header className="rounded-xl border border-line bg-surface px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <Avatar name={nameOf(ticket.tenant as Rel)} tone="brand" />
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-text-muted">
                <Building2 className="h-3.5 w-3.5 text-brand-600" />
                {ticket.tenant_id ? (
                  <Link href={`/admin/tenants/${ticket.tenant_id}`} className="font-semibold text-brand-600 transition hover:underline">
                    {nameOf(ticket.tenant as Rel)}
                  </Link>
                ) : (
                  <span className="font-semibold text-ink-950">{nameOf(ticket.tenant as Rel)}</span>
                )}
                <span aria-hidden>·</span>
                <span>{categoryLabel[ticket.category] ?? ticket.category}</span>
                <span aria-hidden>·</span>
                <span className={`font-semibold ${priorityCls[ticket.priority] ?? ""}`}>{priorityLabel[ticket.priority] ?? ticket.priority}</span>
              </p>
              <h1 className="mt-1.5 font-display text-xl font-bold text-ink-950">{ticket.subject}</h1>
              <p className="mt-1 text-xs text-text-faint">Açılış {dt(ticket.created_at)} · {replyCount} personel yanıtı</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <SlaBadge sla={sla} />
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-canvas px-2.5 py-1 text-[11px] font-bold text-ink-950">
              <span className="h-2 w-2 rounded-full" style={{ background: statusColor[ticket.status] ?? "var(--brand-500)" }} />
              {statusLabel[ticket.status] ?? ticket.status}
            </span>
          </div>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* Ana: konuşma dizisi + yanıt */}
        <div className="space-y-3">
          {ticket.body?.trim() ? (
            <article className="rounded-xl border border-l-2 border-line border-l-transparent bg-surface p-4">
              <div className="flex items-center gap-2.5">
                <Avatar name={nameOf(ticket.tenant as Rel)} tone="brand" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink-950">{nameOf(ticket.tenant as Rel)}</p>
                  <p className="text-[11px] text-text-faint">{dt(ticket.created_at)} · talebi açtı</p>
                </div>
                <span className="rounded-full bg-brand-600/8 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-brand-600">Ofis</span>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink-950/90">{ticket.body}</p>
            </article>
          ) : null}
          {rows.map((m) => {
            const isStaff = m.author_kind === "staff";
            const name = nameMap.get(m.author_user_id ?? "") ?? (isStaff ? "EmlakSoft Destek" : "Ofis kullanıcısı");
            return (
              <article
                key={m.id}
                className={cn(
                  "rounded-xl border border-l-2 p-4",
                  isStaff ? "border-line border-l-amber-400/60 bg-amber-400/[0.03]" : "border-line border-l-transparent bg-surface",
                )}
              >
                <div className="flex items-center gap-2.5">
                  <Avatar name={name} tone={isStaff ? "amber" : "brand"} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink-950">{name}</p>
                    <p className="text-[11px] text-text-faint">{dt(m.created_at)}</p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] ${isStaff ? "bg-amber-400/12 text-amber-600" : "bg-brand-600/8 text-brand-600"}`}>
                    {isStaff ? "Personel" : "Ofis"}
                  </span>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink-950/90">{m.body}</p>
              </article>
            );
          })}

          {/* Yanıt kutusu */}
          <section className="rounded-xl border border-line bg-surface p-4">
            <h2 className="font-display text-sm font-bold text-ink-950">Personel yanıtı</h2>
            <p className="mt-0.5 text-xs text-text-muted">Yanıt sonrası talep “yanıt bekliyor” durumuna alınır.</p>
            <div className="mt-3">
              <StaffReplyForm ticketId={ticket.id} disabled={closed} macros={macros} />
            </div>
          </section>
        </div>

        {/* Yan panel: işlem + özellikler + makrolar */}
        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-xl border border-line bg-surface p-4">
            <h2 className="mb-3 font-display text-sm font-bold text-ink-950">İşlem</h2>
            <TicketDetailControls
              id={ticket.id}
              status={ticket.status}
              statusOptions={statusOptions}
              assignedId={ticket.assigned_staff_id ?? null}
              staff={staff}
            />
          </div>

          <div className="rounded-xl border border-line bg-surface p-4">
            <h2 className="mb-1 font-display text-sm font-bold text-ink-950">Özellikler</h2>
            <dl className="divide-y divide-line">
              <Prop label="Durum">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: statusColor[ticket.status] ?? "var(--brand-500)" }} />
                  {statusLabel[ticket.status] ?? ticket.status}
                </span>
              </Prop>
              <Prop label="Öncelik">
                <span className={priorityCls[ticket.priority] ?? ""}>{priorityLabel[ticket.priority] ?? ticket.priority}</span>
              </Prop>
              <Prop label="Kategori">{categoryLabel[ticket.category] ?? ticket.category}</Prop>
              <Prop label="Ofis">
                {ticket.tenant_id ? (
                  <Link href={`/admin/tenants/${ticket.tenant_id}`} className="text-brand-600 transition hover:underline">
                    {nameOf(ticket.tenant as Rel)}
                  </Link>
                ) : (
                  nameOf(ticket.tenant as Rel)
                )}
              </Prop>
              <Prop label="Atanan">
                {assignedName ? (
                  <span className="inline-flex items-center gap-1 text-cyan-700">
                    <UserRound className="h-3 w-3" /> {assignedName}
                  </span>
                ) : (
                  <span className="text-text-faint">Atanmadı</span>
                )}
              </Prop>
              <Prop label="Açılış">
                <span className="inline-flex items-center gap-1 text-text-muted">
                  <Clock className="h-3 w-3" /> {dt(ticket.created_at)}
                </span>
              </Prop>
              <Prop label="Son güncelleme">{dt(ticket.updated_at)}</Prop>
            </dl>
          </div>

          {isSuperAdmin ? (
            <details className="group rounded-xl border border-line bg-surface p-4">
              <summary className="flex cursor-pointer items-center justify-between text-sm font-bold text-ink-950">
                Makrolar <span className="text-[11px] font-semibold text-text-faint">{macros.length} hazır yanıt</span>
              </summary>
              <div className="mt-3 space-y-3">
                {macros.length === 0 ? (
                  <p className="text-xs text-text-faint">Henüz hazır yanıt yok.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {macros.map((m) => (
                      <li key={m.id} className="flex items-start gap-2 rounded-lg border border-line bg-canvas/50 px-2.5 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-ink-950">{m.title}</p>
                          <p className="mt-0.5 line-clamp-2 text-[11px] text-text-muted">{m.body}</p>
                        </div>
                        <form action={deleteTicketMacroAction}>
                          <input type="hidden" name="id" value={m.id} />
                          <button
                            type="submit"
                            aria-label={`"${m.title}" makrosunu sil`}
                            className="focus-ring rounded-md p-1.5 text-text-faint transition hover:bg-danger-500/10 hover:text-danger-500"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </form>
                      </li>
                    ))}
                  </ul>
                )}
                <form action={createTicketMacroAction} className="space-y-2">
                  <input
                    type="text"
                    name="title"
                    required
                    maxLength={120}
                    placeholder="Makro başlığı (ör. Fatura gecikmesi)"
                    className="w-full rounded-lg border border-line bg-canvas px-2.5 py-2 text-xs outline-none focus:border-brand-400"
                  />
                  <textarea
                    name="body"
                    required
                    rows={3}
                    placeholder="Hazır yanıt metni…"
                    className="w-full resize-none rounded-lg border border-line bg-canvas px-2.5 py-2 text-xs outline-none focus:border-brand-400"
                  />
                  <Button type="submit" size="sm" icon={Plus} className="w-full">
                    Makro ekle
                  </Button>
                </form>
              </div>
            </details>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
