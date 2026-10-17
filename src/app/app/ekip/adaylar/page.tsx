import { PageHeader } from "@/components/ui/page-header";
import { redirect } from "next/navigation";
import Link from "@/components/ui/smart-link";
import { CalendarClock, ClipboardList, Search, UserRoundSearch } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { now } from "@/lib/clock";
import { getBaseUrl } from "@/lib/base-url";
import { ListPage } from "@/components/ui/list-page";
import { SegmentTabs } from "@/components/ui/segment-tabs";
import { FilterChip } from "@/components/ui/filter-chip";
import { FormInput } from "@/components/ui/form-controls";
import { Button } from "@/components/ui/button";
import { EmptyStateV3 } from "@/components/ui/empty-state";
import { formatPhoneDisplay } from "@/lib/phone";
import {
  RECRUIT_SOURCES,
  RECRUIT_SOURCE_LABEL,
  RECRUIT_STAGES,
  RECRUIT_STAGE_LABEL,
  RECRUIT_STAGE_TONE,
  isMissingRecruitSchema,
  isRecruitSource,
  isRecruitStage,
  parseSourceFilter,
  parseStageFilter,
  sanitizeSearch,
  type RecruitStage,
} from "@/lib/recruiting/logic";
import { loadOrientationTemplate } from "@/lib/recruiting/store";
import { NewCandidateDialog } from "./new-candidate-dialog";
import { RecruitFormSettings } from "./form-settings";
import { OrientationTemplateEditor } from "./template-editor";

export const metadata = { title: "Danışman adayları · Ekip" };

type Sp = { sekme?: string; asama?: string; kaynak?: string; q?: string };
type Tab = "hat" | "form" | "oryantasyon";

const TABS: { id: Tab; label: string }[] = [
  { id: "hat", label: "Aday hattı" },
  { id: "form", label: "Kariyer formu" },
  { id: "oryantasyon", label: "Oryantasyon şablonu" },
];

type CandidateRow = {
  id: string;
  full_name: string;
  phone: string | null;
  source: string;
  stage: string;
  experience_years: number | null;
  interview_at: string | null;
  stage_changed_at: string;
  owner: { full_name: string | null } | { full_name: string | null }[] | null;
};

const BASE = "/app/ekip/adaylar";
const CRUMBS = [{ label: "Ekip", href: "/app/ekip" }, { label: "Danışman adayları" }];

function hrefWith(sp: Sp, patch: Partial<Sp>): string {
  const merged = { ...sp, ...patch };
  const q = new URLSearchParams();
  if (merged.sekme && merged.sekme !== "hat") q.set("sekme", merged.sekme);
  if (merged.asama) q.set("asama", merged.asama);
  if (merged.kaynak) q.set("kaynak", merged.kaynak);
  if (merged.q) q.set("q", merged.q);
  const s = q.toString();
  return s ? `${BASE}?${s}` : BASE;
}

const dtFmt = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });

function daysIn(iso: string, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - Date.parse(iso)) / 86_400_000));
}

function CandidateCard({ c, nowMs }: { c: CandidateRow; nowMs: number }) {
  const owner = Array.isArray(c.owner) ? c.owner[0] : c.owner;
  const stage = isRecruitStage(c.stage) ? c.stage : "basvuru";
  const upcoming = c.interview_at && Date.parse(c.interview_at) >= nowMs - 3_600_000 ? c.interview_at : null;
  const days = daysIn(c.stage_changed_at, nowMs);
  return (
    <Link
      href={`${BASE}/${c.id}`}
      className="focus-ring press lift block min-h-11 rounded-[var(--radius-card)] border border-line bg-surface p-3 shadow-[var(--shadow-xs)] transition hover:border-brand-300"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-semibold text-ink-950">{c.full_name}</p>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${RECRUIT_STAGE_TONE[stage]}`}>{RECRUIT_STAGE_LABEL[stage]}</span>
      </div>
      <p className="mt-0.5 truncate text-xs text-text-muted">
        {isRecruitSource(c.source) ? RECRUIT_SOURCE_LABEL[c.source] : "Diğer"}
        {c.experience_years !== null ? ` · ${c.experience_years === 0 ? "yeni başlayan" : `${c.experience_years} yıl deneyim`}` : ""}
        {c.phone ? ` · ${formatPhoneDisplay(c.phone)}` : ""}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
        {upcoming ? (
          <span className="inline-flex items-center gap-1 font-semibold text-brand-700">
            <CalendarClock className="h-3.5 w-3.5" aria-hidden /> {dtFmt.format(new Date(upcoming))}
          </span>
        ) : null}
        <span className={days > 14 && stage !== "katildi" && stage !== "red" ? "font-semibold text-amber-700" : ""}>
          {days === 0 ? "Bugün bu aşamada" : `${days} gündür bu aşamada`}
        </span>
        {owner?.full_name ? <span>· {owner.full_name}</span> : null}
      </div>
    </Link>
  );
}

/**
 * EKİP > DANIŞMAN ADAYLARI (OA9): işe alım hattı (Başvuru → Görüşme → Teklif → Katıldı / Olumsuz), kariyer başvuru
 * formu ayarı ve yeni danışman oryantasyon şablonu. Yalnız ekip yöneticisi (team:edit) görür; RLS aynı kuralı uygular.
 * Masaüstünde aşama sütunları (kanban), mobilde aşama çipleri + tek liste. Filtreler URL'dedir (?asama, ?kaynak, ?q).
 */
export default async function RecruitPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const { perms, tenantId } = await requireModulePage("team", "/app/ekip");
  if (!(perms.team ?? []).includes("edit") || !tenantId) redirect("/app/ekip");
  const sp = await searchParams;
  const tab: Tab = sp.sekme === "form" || sp.sekme === "oryantasyon" ? sp.sekme : "hat";
  const supabase = await createClient();

  const tabNav = <SegmentTabs label="Danışman adayı sekmeleri" active={tab} items={TABS.map((t) => ({ id: t.id, label: t.label, href: hrefWith({}, { sekme: t.id }) }))} />;
  const hero = (
    <PageHeader
        variant="card"
      eyebrow="Ekip · İşe alım"
      art="ekip"
      title="Danışman adayları"
      description="Adayları başvurudan ekibe katılana kadar takip edin; görüşmeleri planlayın, yeni danışmanın oryantasyonunu tek tıkla başlatın."
      breadcrumbs={CRUMBS}
    />
  );

  if (tab === "form") {
    const { data, error } = await supabase.from("recruit_settings").select("form_token, form_enabled, intro, retention_days").eq("tenant_id", tenantId).maybeSingle();
    return (
      <ListPage>
        {hero}
        {tabNav}
        {error && isMissingRecruitSchema(error) ? (
          <EmptyStateV3 title="Kariyer formu henüz etkin değil" description="Bu özellik bu ortamda kurulum bekliyor." />
        ) : (
          <RecruitFormSettings
            url={data?.form_token ? `${getBaseUrl()}/kariyer/${String(data.form_token)}` : null}
            enabled={Boolean(data?.form_enabled)}
            intro={(data?.intro as string | null) ?? null}
            retentionDays={Number(data?.retention_days ?? 180)}
          />
        )}
      </ListPage>
    );
  }

  if (tab === "oryantasyon") {
    const template = await loadOrientationTemplate(supabase, tenantId);
    return (
      <ListPage>
        {hero}
        {tabNav}
        {template.available ? (
          <OrientationTemplateEditor items={template.items} custom={template.custom} />
        ) : (
          <EmptyStateV3 title="Oryantasyon şablonu henüz etkin değil" description="Bu özellik bu ortamda kurulum bekliyor." />
        )}
      </ListPage>
    );
  }

  const stageFilter = parseStageFilter(sp.asama);
  const sourceFilter = parseSourceFilter(sp.kaynak);
  const q = sanitizeSearch(sp.q);
  const nowMs = now();

  let query = supabase
    .from("recruit_candidates")
    .select("id, full_name, phone, source, stage, experience_years, interview_at, stage_changed_at, owner:profiles!recruit_candidates_owner_id_fkey(full_name)")
    .eq("tenant_id", tenantId)
    .order("stage_changed_at", { ascending: false })
    .limit(500);
  if (sourceFilter) query = query.eq("source", sourceFilter);
  if (q) query = query.or(`full_name.ilike.%${q}%,phone.ilike.%${q.replace(/\D/g, "") || q}%,email.ilike.%${q}%`);

  const [{ data, error }, { data: memberRows }] = await Promise.all([
    query,
    supabase.from("profiles").select("id, full_name").eq("tenant_id", tenantId).eq("is_active", true).neq("role", "readonly").order("full_name").limit(500),
  ]);
  if (error && isMissingRecruitSchema(error)) {
    return (
      <ListPage>
        {hero}
        {tabNav}
        <EmptyStateV3 title="Danışman adayı hattı henüz etkin değil" description="Bu özellik bu ortamda kurulum bekliyor." />
      </ListPage>
    );
  }
  const all = (data ?? []) as CandidateRow[];
  const members = ((memberRows ?? []) as { id: string; full_name: string }[]).map((m) => ({ id: m.id, name: m.full_name }));
  const counts = new Map<RecruitStage, number>(RECRUIT_STAGES.map((s) => [s, 0]));
  for (const c of all) if (isRecruitStage(c.stage)) counts.set(c.stage, (counts.get(c.stage) ?? 0) + 1);
  const shown = stageFilter ? all.filter((c) => c.stage === stageFilter) : all;
  const upcomingInterviews = all.filter((c) => c.interview_at && Date.parse(c.interview_at) >= nowMs && (c.stage === "gorusme" || c.stage === "basvuru")).length;
  const filtered = Boolean(stageFilter || sourceFilter || q);

  return (
    <ListPage>
      <PageHeader
        variant="card"
        eyebrow="Ekip · İşe alım"
        art="ekip"
        title="Danışman adayları"
        description="Adayları başvurudan ekibe katılana kadar takip edin; görüşmeleri planlayın, yeni danışmanın oryantasyonunu tek tıkla başlatın."
        breadcrumbs={CRUMBS}
        actions={<NewCandidateDialog members={members} />}
      />
      {tabNav}

      <div className="space-y-3">
        <nav aria-label="Aşamaya göre süz" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          <FilterChip href={hrefWith(sp, { asama: undefined })} active={!stageFilter} count={all.length}>
            Tümü
          </FilterChip>
          {RECRUIT_STAGES.map((s) => (
            <FilterChip key={s} href={hrefWith(sp, { asama: s })} active={stageFilter === s} count={counts.get(s) ?? 0}>
              {RECRUIT_STAGE_LABEL[s]}
            </FilterChip>
          ))}
        </nav>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <nav aria-label="Kaynağa göre süz" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            <FilterChip href={hrefWith(sp, { kaynak: undefined })} active={!sourceFilter}>
              Tüm kaynaklar
            </FilterChip>
            {RECRUIT_SOURCES.map((s) => (
              <FilterChip key={s} href={hrefWith(sp, { kaynak: s })} active={sourceFilter === s}>
                {RECRUIT_SOURCE_LABEL[s]}
              </FilterChip>
            ))}
          </nav>
          <form action={BASE} method="get" role="search" className="flex gap-2 sm:w-72">
            {/* Süzgeç kontratı: aramada aşama/kaynak süzgeci korunur. */}
            {([["asama", stageFilter], ["kaynak", sourceFilter]] as const).filter(([, v]) => v).map(([k, v]) => <input key={k} type="hidden" name={k} value={v ?? ""} />)}
            <label htmlFor="aday-ara" className="sr-only">
              Aday ara
            </label>
            <FormInput id="aday-ara" name="q" type="search" defaultValue={q} placeholder="Ad, telefon, e-posta" className="min-w-0 flex-1" />
            <Button type="submit" variant="secondary" size="icon" icon={Search} aria-label="Ara" />
          </form>
        </div>
        {upcomingInterviews > 0 ? (
          <Link href={hrefWith(sp, { asama: "gorusme" })} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline">
            <CalendarClock className="h-4 w-4" aria-hidden /> {upcomingInterviews} yaklaşan aday görüşmesi
          </Link>
        ) : null}
      </div>

      {all.length === 0 ? (
        <EmptyStateV3
          icon={UserRoundSearch}
          title={filtered ? "Bu süzgeçte aday yok" : "Henüz danışman adayı yok"}
          description={
            filtered
              ? "Süzgeci temizleyip tüm adaylara bakabilirsiniz."
              : "Adayı elle ekleyin ya da Kariyer formu sekmesinden başvuru bağlantınızı yayınlayıp paylaşın; başvurular buraya düşer."
          }
          action={filtered ? { label: "Süzgeci temizle", href: BASE } : { label: "Kariyer formunu aç", href: hrefWith({}, { sekme: "form" }) }}
        />
      ) : stageFilter ? (
        shown.length === 0 ? (
          <EmptyStateV3 icon={ClipboardList} title={`"${RECRUIT_STAGE_LABEL[stageFilter]}" aşamasında aday yok`} action={{ label: "Tüm adaylar", href: hrefWith(sp, { asama: undefined }) }} />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((c) => (
              <li key={c.id}>
                <CandidateCard c={c} nowMs={nowMs} />
              </li>
            ))}
          </ul>
        )
      ) : (
        <>
          {/* Mobil / tablet: aşama sırasına göre tek liste (yatay kaydırmalı kanban dar ekranda kullanışsız). */}
          <div className="space-y-4 lg:hidden">
            {RECRUIT_STAGES.filter((s) => (counts.get(s) ?? 0) > 0).map((s) => (
              <section key={s} aria-labelledby={`m-stage-${s}`} className="space-y-2">
                <h2 id={`m-stage-${s}`} className="flex items-center justify-between text-sm font-bold text-ink-950">
                  {RECRUIT_STAGE_LABEL[s]}
                  <Link href={hrefWith(sp, { asama: s })} className="inline-flex min-h-11 items-center px-2 text-xs font-semibold text-brand-600">
                    {counts.get(s)} aday
                  </Link>
                </h2>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {all
                    .filter((c) => c.stage === s)
                    .slice(0, 20)
                    .map((c) => (
                      <li key={c.id}>
                        <CandidateCard c={c} nowMs={nowMs} />
                      </li>
                    ))}
                </ul>
              </section>
            ))}
          </div>
          {/* Masaüstü: aşama sütunları. */}
          <div className="hidden gap-3 lg:grid lg:grid-cols-5">
            {RECRUIT_STAGES.map((s) => {
              const col = all.filter((c) => c.stage === s);
              return (
                <section key={s} aria-labelledby={`d-stage-${s}`} className="flex min-w-0 flex-col gap-2 rounded-[var(--radius-panel)] border border-line bg-canvas/60 p-2">
                  <h2 id={`d-stage-${s}`} className="flex items-center justify-between px-1 pt-1 text-xs font-bold uppercase tracking-wide text-text-muted">
                    <Link href={hrefWith(sp, { asama: s })} className="hover:text-brand-600">
                      {RECRUIT_STAGE_LABEL[s]}
                    </Link>
                    <span className={`num rounded-full px-2 py-0.5 text-xs ${RECRUIT_STAGE_TONE[s]}`}>{col.length}</span>
                  </h2>
                  {col.length === 0 ? <p className="px-1 py-6 text-center text-xs text-text-faint">Aday yok</p> : null}
                  {col.slice(0, 25).map((c) => (
                    <CandidateCard key={c.id} c={c} nowMs={nowMs} />
                  ))}
                  {col.length > 25 ? (
                    <Link href={hrefWith(sp, { asama: s })} className="px-1 py-2 text-center text-xs font-semibold text-brand-600 hover:underline">
                      Tümünü gör ({col.length})
                    </Link>
                  ) : null}
                </section>
              );
            })}
          </div>
        </>
      )}
    </ListPage>
  );
}
