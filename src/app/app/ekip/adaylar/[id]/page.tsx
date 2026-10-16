import { notFound, redirect } from "next/navigation";
import Link from "@/components/ui/smart-link";
import { BriefcaseBusiness, CalendarClock, History, Mail, MessageCircle, MessageSquareText, Phone, UserCheck, UserRoundPlus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { now, toTrLocalInput } from "@/lib/clock";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyStateV3 } from "@/components/ui/empty-state";
import { formatPhoneDisplay, toTelHref, toWhatsAppLink } from "@/lib/phone";
import {
  RECRUIT_SOURCE_LABEL,
  RECRUIT_STAGES,
  RECRUIT_STAGE_LABEL,
  RECRUIT_STAGE_TONE,
  isMissingRecruitSchema,
  isRecruitSource,
  isRecruitStage,
} from "@/lib/recruiting/logic";
import {
  DeleteCandidateButton,
  DeleteNoteButton,
  EditCandidateDialog,
  InterviewForm,
  LinkMemberForm,
  NoteForm,
  StageActions,
} from "./candidate-actions";
import { IconChip } from "@/components/ui/icons";

export const metadata = { title: "Danışman adayı · Ekip" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Rel = { full_name: string | null } | { full_name: string | null }[] | null;
const relName = (r: Rel) => (Array.isArray(r) ? r[0]?.full_name : r?.full_name) ?? null;

type Candidate = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  source: string;
  stage: string;
  owner_id: string | null;
  experience_years: number | null;
  current_office: string | null;
  message: string | null;
  reject_reason: string | null;
  interview_at: string | null;
  interview_task_id: string | null;
  profile_id: string | null;
  kvkk_consent_at: string | null;
  created_at: string;
  owner: Rel;
  member: Rel;
};

type Event = { id: string; kind: string; body: string | null; from_stage: string | null; to_stage: string | null; created_at: string; actor_id: string | null; actor: Rel };

const dtFmt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" });
const fmt = (iso: string) => dtFmt.format(new Date(iso));

const EVENT_LABEL: Record<string, string> = {
  note: "Not",
  stage: "Aşama",
  interview: "Görüşme planlandı",
  applied: "Başvuru",
  created: "Kayıt",
  joined: "Ekibe katıldı",
};

function Section({ title, icon, children, id }: { title: string; icon: React.ReactNode; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="space-y-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)] sm:p-5">
      <h2 className="flex items-center gap-2 text-sm font-bold text-ink-950">
        {icon} {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * Danışman adayı kartı (OA9): aşama şeridi + sonraki adım, görüşme planlama (görev), notlar/zaman çizelgesi,
 * "Katıldı" → ekip üyesine bağla + oryantasyon. Yalnız team:edit.
 */
export default async function CandidatePage({ params }: { params: Promise<{ id: string }> }) {
  const { perms, tenantId, userId } = await requireModulePage("team", "/app/ekip");
  if (!(perms.team ?? []).includes("edit") || !tenantId) redirect("/app/ekip");
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const supabase = await createClient();

  const [{ data, error }, { data: events }, { data: memberRows }, { data: linkedRows }] = await Promise.all([
    supabase
      .from("recruit_candidates")
      .select(
        "id, full_name, phone, email, source, stage, owner_id, experience_years, current_office, message, reject_reason, interview_at, interview_task_id, profile_id, kvkk_consent_at, created_at, owner:profiles!recruit_candidates_owner_id_fkey(full_name), member:profiles!recruit_candidates_profile_id_fkey(full_name)",
      )
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase
      .from("recruit_candidate_events")
      .select("id, kind, body, from_stage, to_stage, created_at, actor_id, actor:profiles!recruit_candidate_events_actor_id_fkey(full_name)")
      .eq("candidate_id", id)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("profiles").select("id, full_name, created_at").eq("tenant_id", tenantId).eq("is_active", true).neq("role", "readonly").order("created_at", { ascending: false }).limit(500),
    // Başka adaya bağlı üyeler "bağla" listesinde en sona itilir (yeni açılan hesap üstte).
    supabase.from("recruit_candidates").select("profile_id").eq("tenant_id", tenantId).not("profile_id", "is", null).limit(1000),
  ]);
  if (error && isMissingRecruitSchema(error)) {
    return <EmptyStateV3 title="Danışman adayı hattı henüz etkin değil" description="Bu özellik bu ortamda kurulum bekliyor." />;
  }
  if (!data) notFound();
  const c = data as Candidate;
  const stage = isRecruitStage(c.stage) ? c.stage : "basvuru";
  const nowMs = now();
  const members = ((memberRows ?? []) as { id: string; full_name: string }[]).map((m) => ({ id: m.id, name: m.full_name }));
  const membersByName = [...members].sort((a, b) => a.name.localeCompare(b.name, "tr"));
  const linked = new Set(((linkedRows ?? []) as { profile_id: string }[]).map((r) => r.profile_id));
  const linkOptions = [...members.filter((m) => !linked.has(m.id)), ...members.filter((m) => linked.has(m.id) && m.id !== c.profile_id)];
  const timeline = (events ?? []) as Event[];
  const tel = toTelHref(c.phone);
  const wa = c.phone ? toWhatsAppLink(c.phone, `Merhaba ${c.full_name.split(" ")[0]}, danışmanlık başvurunuz için yazıyorum.`) : null;
  const stageIndex = RECRUIT_STAGES.indexOf(stage);
  const upcoming = c.interview_at && Date.parse(c.interview_at) >= nowMs - 3_600_000;

  return (
    <div className="space-y-5">
      <PageHeader icon={<IconChip icon={UserRoundPlus} size="lg" />}
        breadcrumbs={[
          { label: "Ekip", href: "/app/ekip" },
          { label: "Danışman adayları", href: "/app/ekip/adaylar" },
          { label: c.full_name },
        ]}
        title={c.full_name}
        meta={<span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${RECRUIT_STAGE_TONE[stage]}`}>{RECRUIT_STAGE_LABEL[stage]}</span>}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{isRecruitSource(c.source) ? RECRUIT_SOURCE_LABEL[c.source] : "Diğer"}</span>
            {c.experience_years !== null ? <span>{c.experience_years === 0 ? "Yeni başlayan" : `${c.experience_years} yıl deneyim`}</span> : null}
            {c.current_office ? <span>{c.current_office}</span> : null}
            {relName(c.owner) ? <span>Sorumlu: {relName(c.owner)}</span> : null}
          </span>
        }
        actions={
          <EditCandidateDialog
            id={c.id}
            members={membersByName}
            defaults={{
              full_name: c.full_name,
              phone: c.phone,
              email: c.email,
              source: c.source,
              owner_id: c.owner_id,
              experience_years: c.experience_years,
              current_office: c.current_office,
              message: c.message,
            }}
          />
        }
      />

      {/* İletişim: mobilde başparmakla tek dokunuş (≥44px). */}
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        {tel ? (
          <a href={tel} className="focus-ring press inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-4 text-sm font-semibold text-ink-950 hover:border-brand-300">
            <Phone className="h-4 w-4" aria-hidden /> {formatPhoneDisplay(c.phone)}
          </a>
        ) : null}
        {wa ? (
          <a href={wa} target="_blank" rel="noopener noreferrer" className="focus-ring press inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-4 text-sm font-semibold text-ink-950 hover:border-brand-300">
            <MessageCircle className="h-4 w-4" aria-hidden /> WhatsApp
          </a>
        ) : null}
        {c.email ? (
          <a href={`mailto:${c.email}`} className="focus-ring press col-span-2 inline-flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-4 text-sm font-semibold text-ink-950 hover:border-brand-300 sm:col-span-1">
            <Mail className="h-4 w-4 shrink-0" aria-hidden /> <span className="truncate">{c.email}</span>
          </a>
        ) : null}
      </div>

      {/* Aşama şeridi */}
      <section aria-label="Aday aşaması" className="space-y-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)] sm:p-5">
        <ol className="grid grid-cols-4 gap-1.5">
          {RECRUIT_STAGES.filter((s) => s !== "red").map((s, i) => {
            const reached = stage !== "red" && i <= stageIndex;
            return (
              <li key={s} aria-current={s === stage ? "step" : undefined} className="min-w-0">
                <span className={`block h-1.5 rounded-full ${reached ? "bg-brand-600" : "bg-surface-sunken"}`} />
                <span className={`mt-1 block truncate text-xs ${s === stage ? "font-bold text-ink-950" : "text-text-muted"}`}>{RECRUIT_STAGE_LABEL[s]}</span>
              </li>
            );
          })}
        </ol>
        {stage === "red" && c.reject_reason ? (
          <p className="rounded-[var(--radius-control)] bg-danger-500/6 px-3 py-2 text-sm text-ink-950">
            <span className="font-semibold">Olumsuz sonuç:</span> {c.reject_reason}
          </p>
        ) : null}
        <StageActions id={c.id} stage={stage} />
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          {stage === "katildi" || stage === "teklif" || c.profile_id ? (
            <Section id="katilim" title="Ekibe katılım" icon={<UserCheck className="h-4 w-4 text-mint-600" aria-hidden />}>
              <LinkMemberForm id={c.id} members={linkOptions} linkedName={relName(c.member)} />
              {c.profile_id ? (
                <Link href={`/app/ekip/${c.profile_id}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-600 hover:underline">
                  Danışman sayfasını ve oryantasyon ilerlemesini aç
                </Link>
              ) : null}
            </Section>
          ) : null}

          {stage !== "katildi" && stage !== "red" ? (
            <Section title="Görüşme" icon={<CalendarClock className="h-4 w-4 text-brand-600" aria-hidden />}>
              {c.interview_at ? (
                <p className={`text-sm ${upcoming ? "font-semibold text-brand-700" : "text-text-muted"}`}>
                  {upcoming ? "Planlı görüşme" : "Son görüşme"}: {fmt(c.interview_at)}
                  {c.interview_task_id ? (
                    <>
                      {" · "}
                      <Link href={`/app/gorevler?gorev=${c.interview_task_id}`} className="font-semibold text-brand-600 hover:underline">
                        Görevi aç
                      </Link>
                    </>
                  ) : null}
                </p>
              ) : (
                <p className="text-xs text-text-muted">Görüşme, seçtiğiniz kişiye görev olarak atanır; görev hatırlatmaları ve takvim aynen çalışır.</p>
              )}
              <InterviewForm id={c.id} members={membersByName} defaultInterviewer={c.owner_id ?? userId} minLocal={toTrLocalInput(nowMs)} />
            </Section>
          ) : null}

          {c.message ? (
            <Section title="Aday notu / başvuru mesajı" icon={<BriefcaseBusiness className="h-4 w-4 text-brand-600" aria-hidden />}>
              <p className="whitespace-pre-line text-sm text-ink-950">{c.message}</p>
            </Section>
          ) : null}
        </div>

        <Section title="Notlar ve geçmiş" icon={<History className="h-4 w-4 text-brand-600" aria-hidden />}>
          <NoteForm id={c.id} />
          {timeline.length === 0 ? (
            <p className="text-xs text-text-muted">Henüz kayıt yok.</p>
          ) : (
            <ol className="space-y-2">
              {timeline.map((e) => (
                <li key={e.id} className="flex items-start gap-2 rounded-[var(--radius-card)] border border-line bg-canvas/60 p-3">
                  <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-text-faint" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-text-muted">
                      <span className="font-semibold text-ink-950">{EVENT_LABEL[e.kind] ?? e.kind}</span>
                      {e.to_stage && isRecruitStage(e.to_stage) ? ` → ${RECRUIT_STAGE_LABEL[e.to_stage]}` : ""} · {fmt(e.created_at)}
                      {relName(e.actor) ? ` · ${relName(e.actor)}` : ""}
                    </p>
                    {e.body ? <p className="mt-1 whitespace-pre-line text-sm text-ink-950">{e.body}</p> : null}
                  </div>
                  {e.kind === "note" && e.actor_id === userId ? <DeleteNoteButton id={e.id} candidateId={c.id} /> : null}
                </li>
              ))}
            </ol>
          )}
        </Section>
      </div>

      <footer className="flex flex-col gap-2 border-t border-line pt-4 text-xs text-text-muted sm:flex-row sm:items-center sm:justify-between">
        <p>
          Kayıt: {fmt(c.created_at)}
          {c.kvkk_consent_at ? ` · KVKK aydınlatma/rıza: ${fmt(c.kvkk_consent_at)}` : ""}. Sonuçlanan aday kaydı saklama süresi dolunca otomatik silinir.
        </p>
        <DeleteCandidateButton id={c.id} />
      </footer>
    </div>
  );
}
