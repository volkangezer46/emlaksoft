import Link from "@/components/ui/smart-link";
import { ArrowLeft, Pencil } from "lucide-react";
import { FilterChip } from "@/components/ui/filter-chip";
import { RegistrySettings } from "@/components/settings/registry-settings";
import { Pagination, pageRange } from "@/app/admin/_components/pagination";
import { now, toTrLocalInput } from "@/lib/clock";
import { describeSegment, parseSegment } from "@/lib/platform-announcements/segment";
import { NPS_CATEGORY_LABEL, NPS_DEFAULT_QUESTION, summarizeNps, type NpsCategory } from "@/lib/product-feedback/model";
import { listSurveyComments, listSurveysForAdmin, type AdminSurveyRow } from "@/lib/product-feedback/store";
import { FEEDBACK_SETTING_KEYS } from "@/lib/settings/registry/feedback";
import { NpsForm, NpsToggle, type NpsInit } from "./nps-form";
import type { SegmentInit, SegmentOptions } from "./segment-builder";

const BASE = "/admin/duyuru?sekme=nps";
const BANDS: readonly NpsCategory[] = ["promoter", "passive", "detractor"];
const BAND_TONE: Record<NpsCategory, string> = { promoter: "bg-mint-500", passive: "bg-amber-400", detractor: "bg-danger-500" };

const fmt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" });

function stateOf(s: AdminSurveyRow, t: number) {
  if (!s.isActive) return "Kaldırıldı";
  if (new Date(s.startsAt).getTime() > t) return "Planlı";
  if (s.endsAt && new Date(s.endsAt).getTime() <= t) return "Bitti";
  return "Yayında";
}

function segInitOf(raw: unknown): SegmentInit | undefined {
  const seg = parseSegment(raw);
  if (!seg.ok) return undefined;
  const v = seg.value;
  return {
    plans: v.plans,
    statuses: v.statuses,
    trialDays: v.trialEndsWithinDays?.toString(),
    loginMode: v.lastLogin?.mode,
    loginDays: v.lastLogin?.days.toString(),
    city: v.cities?.join(", "),
    module: v.module?.key,
    moduleState: v.module ? (v.module.enabled ? "on" : "off") : "on",
    owners: Boolean(v.ownersOnly),
    tenant: v.tenantIds?.length === 1 ? v.tenantIds[0] : undefined,
  };
}

/**
 * NPS anketi sekmesi (DG8): anket formu + anket listesi (gösterim, yanıt, NPS) + seçili anketin sonuçları
 * (dağılım ve yorumlar; destekçi/pasif/eleştiren süzgeci). Her sayı kendi süzülmüş görünümüne götürür.
 */
export async function NpsPanel({
  options,
  canEdit,
  isSuperAdmin,
  editId,
  surveyId,
  band,
  page,
}: {
  options: SegmentOptions;
  canEdit: boolean;
  isSuperAdmin: boolean;
  editId?: string;
  surveyId?: string;
  band: NpsCategory | null;
  page: number;
}) {
  const { ready, rows, truncated } = await listSurveysForAdmin();
  if (!ready) {
    return (
      <p className="rounded-[var(--radius-panel)] border border-amber-400/30 bg-amber-400/8 px-5 py-6 text-sm text-amber-700">
        Kurulum bekliyor: NPS tabloları veritabanı güncellemesiyle (20261014008000) gelir.
      </p>
    );
  }
  const t = now();
  const selected = surveyId ? rows.find((s) => s.id === surveyId) : undefined;
  if (selected) return <SurveyResults survey={selected} band={band} page={page} />;

  const editing = editId ? rows.find((s) => s.id === editId) : undefined;
  const init: NpsInit | undefined = editing
    ? { id: editing.id, question: editing.question, startsLocal: toTrLocalInput(editing.startsAt), endsLocal: editing.endsAt ? toTrLocalInput(editing.endsAt) : "" }
    : undefined;

  return (
    <div className="space-y-5">
      {canEdit ? (
        <NpsForm
          key={editing?.id ?? "yeni"}
          options={options}
          init={init}
          segInit={editing ? segInitOf(editing.segment) : undefined}
          minLocal={toTrLocalInput(t)}
          defaultQuestion={NPS_DEFAULT_QUESTION}
        />
      ) : null}
      <section className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
        <div className="border-b border-line px-5 py-4">
          <h2 className="font-display font-bold text-ink-950">NPS anketleri</h2>
          <p className="mt-1 text-xs text-text-muted">
            Kullanıcıya aynı anda tek anket gösterilir (en yeni yayındaki); sıklık sınırı kullanıcı başınadır ve tüm anketler için ortaktır.
            {truncated ? " Gösterim sayıları üst sınıra ulaştı; sayılar eksik olabilir." : ""}
          </p>
        </div>
        {rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-text-muted">
            Henüz anket yok. Yukarıdan bir NPS anketi yayınlayın; ofis kullanıcılarına panelin köşesinde 0-10 puanlık soru olarak gösterilir.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((s) => {
              const sum = summarizeNps(s.scores);
              const seg = parseSegment(s.segment);
              const href = `${BASE}&anket=${s.id}`;
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <Link href={href} className="block truncate text-sm font-semibold text-ink-950 hover:text-brand-600">
                      {s.question}
                    </Link>
                    <p className="text-xs text-text-muted">
                      {stateOf(s, t)} · {fmt.format(new Date(s.startsAt))}
                      {s.endsAt ? ` – ${fmt.format(new Date(s.endsAt))}` : " – süresiz"} ·{" "}
                      {s.tenantCount !== null ? `${s.tenantCount} ofis${seg.ok ? ` (${describeSegment(seg.value)})` : ""}` : seg.ok && seg.value.ownersOnly ? "Tüm ofisler · yalnız sahipler" : "Tüm ofisler"}
                    </p>
                  </div>
                  <Link href={href} className="text-xs text-text-muted hover:text-brand-600">
                    <strong className="numeric text-ink-950">{s.shown}</strong> gösterim · <strong className="numeric text-ink-950">{sum.responses}</strong> yanıt ·{" "}
                    NPS <strong className="numeric text-ink-950">{sum.nps ?? "—"}</strong>
                  </Link>
                  {canEdit ? (
                    <span className="flex items-center gap-2">
                      <Link
                        href={`${BASE}&duzenle=${s.id}#nps-formu`}
                        className="inline-flex min-h-9 touch:min-h-11 items-center gap-1 rounded-[var(--radius-control)] border border-line px-2.5 text-xs font-semibold text-ink-950 hover:border-brand-600"
                      >
                        <Pencil className="h-3.5 w-3.5 text-brand-600" aria-hidden /> Düzenle
                      </Link>
                      <NpsToggle id={s.id} active={s.isActive} />
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <RegistrySettings
        id="nps-ayarlari"
        title="NPS ayarları"
        description="Anketin açık olup olmadığı ve bir kullanıcıya en fazla kaç günde bir sorulacağı. Ofis/plan/yüzde hedeflemesi Ayarlar > Özellik bayrakları ekranında."
        keys={[FEEDBACK_SETTING_KEYS.npsEnabled, FEEDBACK_SETTING_KEYS.npsIntervalDays]}
        canEdit={isSuperAdmin}
      />
    </div>
  );
}

async function SurveyResults({ survey, band, page }: { survey: AdminSurveyRow; band: NpsCategory | null; page: number }) {
  const sum = summarizeNps(survey.scores);
  const [from, to] = pageRange(page);
  const comments = await listSurveyComments({ surveyId: survey.id, band, from, to });
  const self = `${BASE}&anket=${survey.id}`;
  const bandHref = (b: NpsCategory | null) => (b ? `${self}&grup=${b}` : self);
  const max = Math.max(1, ...sum.distribution);
  const rate = survey.shown ? Math.round((sum.responses / survey.shown) * 100) : null;
  const count: Record<NpsCategory, number> = { promoter: sum.promoters, passive: sum.passives, detractor: sum.detractors };

  return (
    <div className="space-y-5">
      <Link href={BASE} className="inline-flex min-h-9 touch:min-h-11 items-center gap-1 text-xs font-semibold text-brand-600 hover:underline">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Tüm anketler
      </Link>
      <section className="space-y-4 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
        <div>
          <h2 className="font-display font-bold text-ink-950">{survey.question}</h2>
          <p className="text-xs text-text-muted">
            {survey.shown} gösterim · {sum.responses} yanıt{rate !== null ? ` (%${rate} yanıt oranı)` : ""}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <Link href={bandHref(null)} className="rounded-[var(--radius-card)] border border-line bg-canvas p-3 hover:border-brand-600">
            <span className="block text-xs text-text-muted">NPS (−100…100)</span>
            <span className="numeric font-display text-2xl font-bold text-ink-950">{sum.nps ?? "—"}</span>
          </Link>
          {BANDS.map((b) => (
            <Link key={b} href={bandHref(b)} className={`rounded-[var(--radius-card)] border bg-canvas p-3 hover:border-brand-600 ${band === b ? "border-brand-600" : "border-line"}`}>
              <span className="block text-xs text-text-muted">{NPS_CATEGORY_LABEL[b]}</span>
              <span className="numeric font-display text-2xl font-bold text-ink-950">{count[b]}</span>
            </Link>
          ))}
        </div>
        {sum.responses ? (
          <div aria-label="Puan dağılımı" className="grid grid-cols-11 items-end gap-1">
            {sum.distribution.map((n, score) => {
              const b: NpsCategory = score >= 9 ? "promoter" : score >= 7 ? "passive" : "detractor";
              return (
                <Link key={score} href={bandHref(b)} className="flex flex-col items-center gap-1" title={`${score} puan: ${n} yanıt`}>
                  <span className="numeric text-xs text-text-muted">{n}</span>
                  <span className={`w-full rounded-t ${BAND_TONE[b]}`} style={{ height: `${Math.max(2, Math.round((n / max) * 80))}px` }} aria-hidden />
                  <span className="numeric text-xs font-semibold text-ink-950">{score}</span>
                </Link>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-text-muted">Henüz yanıt yok. Yanıtlar geldikçe dağılım ve yorumlar burada görünür.</p>
        )}
      </section>

      <section className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-4">
          <h2 className="mr-auto font-display font-bold text-ink-950">Yorumlar</h2>
          <FilterChip href={bandHref(null)} active={!band}>
            Tümü
          </FilterChip>
          {BANDS.map((b) => (
            <FilterChip key={b} href={bandHref(b)} active={band === b} tone={b === "detractor" ? "danger" : "default"}>
              {NPS_CATEGORY_LABEL[b]}
            </FilterChip>
          ))}
        </div>
        {comments.rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-text-muted">Bu süzgeçte yorum yok.</p>
        ) : (
          <ul className="divide-y divide-line">
            {comments.rows.map((c) => (
              <li key={c.id} className="flex gap-3 px-5 py-3">
                <span className="numeric flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-canvas text-sm font-bold text-ink-950">{c.score}</span>
                <div className="min-w-0 flex-1">
                  <p className="whitespace-pre-line text-sm text-ink-950">{c.comment}</p>
                  <p className="mt-0.5 text-xs text-text-muted">
                    <Link href={`/admin/tenants/${c.tenantId}`} className="hover:text-brand-600">
                      {c.tenantName ?? "Ofis"}
                    </Link>{" "}
                    · {fmt.format(new Date(c.respondedAt))}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="px-5 pb-4">
          <Pagination page={page} total={comments.total} hrefFor={(p) => (p > 1 ? `${bandHref(band)}&sayfa=${p}` : bandHref(band))} />
        </div>
      </section>
    </div>
  );
}
