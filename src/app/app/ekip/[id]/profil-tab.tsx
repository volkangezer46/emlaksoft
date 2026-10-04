import Link from "next/link";
import type { ReactNode } from "react";
import { BadgeCheck, FileWarning, ShieldCheck } from "lucide-react";
import type { createClient } from "@/lib/supabase/server";
import { Alert } from "@/components/ui/alert";
import { EmptyStateV3 } from "@/components/ui/empty-state-v3";
import { getProvincesCached } from "@/lib/geo";
import { piiEnabled } from "@/lib/advisor/pii-crypto";
import { loadPrivateSummary } from "@/lib/advisor/advisor-store";
import {
  DOC_KIND_LABEL,
  DOC_STATE_LABEL,
  EMPLOYMENT_TYPES,
  WEEK_DAYS,
  docExpiryStatus,
  formatDocCountdown,
  type DocKind,
  type DocState,
  type WorkProfileRow,
} from "@/lib/advisor/advisor-profile";
import { PrivateEditor, WorkProfileEditor } from "./profil-editors";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const STATE_TONE: Record<DocState, string> = {
  none: "tone-neutral",
  expired: "tone-danger",
  week: "tone-danger",
  month: "tone-warning",
  ok: "tone-success",
};

/** Belge kartı bağlantısı: süresi dolan / yaklaşan belgeler ofis genelindeki süzgece gider (tıklanabilir metrik). */
export function docFilterHref(state: DocState, kind?: DocKind): string | null {
  const durum = state === "expired" ? "suresi_doldu" : state === "week" ? "7" : state === "month" ? "30" : null;
  if (!durum) return null;
  return `/app/ekip/belgeler?durum=${durum}${kind ? `&belge=${kind}` : ""}`;
}

function dateTr(day: string | null): string {
  if (!day) return "—";
  const [y, m, d] = day.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}

function Section({ id, title, icon, children }: { id?: string; title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-ink-950">{icon} {title}</h2>
      {children}
    </section>
  );
}

function DocCard({ kind, no, expiresOn, todayKey, canLink }: { kind: DocKind; no: string | null; expiresOn: string | null; todayKey: string; canLink: boolean }) {
  const status = docExpiryStatus(expiresOn, todayKey);
  const href = canLink ? docFilterHref(status.state, kind) : null;
  const body = (
    <>
      <p className="text-xs font-semibold text-text-muted">{DOC_KIND_LABEL[kind]}</p>
      <p className="mt-1 text-sm font-semibold text-ink-950">{no ?? "Belge no girilmedi"}</p>
      <p className="mt-0.5 text-xs text-text-muted">Bitiş: {dateTr(expiresOn)}</p>
      <p className={`mt-2 inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATE_TONE[status.state]}`}>
        {status.state === "none" || status.state === "ok" ? `${DOC_STATE_LABEL[status.state]}${status.daysLeft !== null ? ` · ${formatDocCountdown(status)}` : ""}` : `${DOC_STATE_LABEL[status.state]} · ${formatDocCountdown(status)}`}
      </p>
    </>
  );
  const cls = "block rounded-[var(--radius-control)] border border-line bg-canvas/60 p-4";
  return href ? (
    <Link href={href} className={`${cls} focus-ring press transition hover:border-brand-300`}>{body}</Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function ReadOnlySummary({ work }: { work: WorkProfileRow | null }) {
  const emp = EMPLOYMENT_TYPES.find((e) => e.value === work?.employment_type)?.label ?? "—";
  const days = (work?.work_days ?? []).map((n) => WEEK_DAYS.find((d) => d.n === n)?.label).filter(Boolean).join(", ") || "—";
  const rows: [string, string][] = [
    ["İstihdam türü", emp],
    ["İşe giriş", dateTr(work?.hired_at ?? null)],
    ["Ayrılış", dateTr(work?.left_at ?? null)],
    ["Aktif ilan üst sınırı", work?.max_active_listings != null ? String(work.max_active_listings) : "Sınırsız"],
    ["Aktif talep üst sınırı", work?.max_active_demands != null ? String(work.max_active_demands) : "Sınırsız"],
    ["Çalışma günleri", days],
    ["Mesai", work?.work_start && work.work_end ? `${work.work_start.slice(0, 5)} - ${work.work_end.slice(0, 5)}` : "—"],
    ["İlan havuzu", work ? (work.accepts_pool ? "Kabul ediyor" : "Kapalı") : "—"],
  ];
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k} className="rounded-[var(--radius-control)] border border-line bg-canvas/60 px-3 py-2">
          <dt className="text-xs text-text-muted">{k}</dt>
          <dd className="mt-0.5 text-sm font-semibold text-ink-950">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * "Profil ve belgeler" sekmesi: belge bitiş kartları (30/7 gün uyarısı), iş profili (ofis sahibi / GM düzenler,
 * diğerleri salt okunur) ve kimlik bölümü (yalnız ofis sahibi, GM ve kişinin kendisi; TC/IBAN maskeli, "Göster" denetimli).
 * Şema uygulanmamışsa sekme hiç çizilmez (çağıran `work.available` ile gizler); bu bileşen yine de zarif boş durum verir.
 */
export async function ProfileTab({
  supabase,
  tenantId,
  memberId,
  viewerId,
  viewerRole,
  work,
  workAvailable,
  todayKey,
}: {
  supabase: Supabase;
  tenantId: string;
  memberId: string;
  viewerId: string;
  viewerRole: string;
  work: WorkProfileRow | null;
  workAvailable: boolean;
  todayKey: string;
}) {
  const canManage = viewerRole === "owner" || viewerRole === "gm";
  const isSelf = memberId === viewerId;
  const canSeePrivate = canManage || isSelf;

  const [priv, provinces] = await Promise.all([
    canSeePrivate ? loadPrivateSummary(supabase, tenantId, memberId) : Promise.resolve(null),
    canSeePrivate ? getProvincesCached() : Promise.resolve([]),
  ]);

  if (!workAvailable && !(priv?.available ?? false)) {
    return (
      <EmptyStateV3
        title="Profil ve belgeler bu ortamda henüz etkin değil"
        description="Danışman iş profili ve belge takibi veritabanı güncellemesi uygulandığında açılır."
      />
    );
  }

  return (
    <div className="space-y-6">
      {workAvailable ? (
        <Section title="Belgeler" icon={<BadgeCheck className="h-4 w-4 text-brand-600" />}>
          <div className="grid gap-3 sm:grid-cols-2">
            <DocCard kind="authority" no={work?.authority_cert_no ?? null} expiresOn={work?.authority_cert_expires_on ?? null} todayKey={todayKey} canLink={canManage} />
            <DocCard kind="spk" no={work?.spk_cert_no ?? null} expiresOn={work?.spk_cert_expires_on ?? null} todayKey={todayKey} canLink={canManage} />
          </div>
          <p className="mt-3 text-xs text-text-muted">
            Belge bitişine 30 ve 7 gün kala ofis sahibine uyarı görünür.{" "}
            {canManage ? <Link href="/app/ekip/belgeler" className="font-semibold text-brand-600 hover:underline">Tüm danışmanların belge durumu</Link> : null}
          </p>
        </Section>
      ) : null}

      {workAvailable ? (
        <Section title="İş profili" icon={<ShieldCheck className="h-4 w-4 text-mint-600" />}>
          {canManage ? <WorkProfileEditor profileId={memberId} defaults={work} /> : <ReadOnlySummary work={work} />}
        </Section>
      ) : null}

      {canSeePrivate && priv?.available ? (
        <Section id="kimlik" title="Kimlik ve kişisel bilgiler" icon={<FileWarning className="h-4 w-4 text-amber-600" />}>
          <p className="mb-4 text-xs text-text-muted">
            Bu bölümü yalnız ofis sahibi, genel müdür ve kişinin kendisi görür. TC kimlik ve IBAN sunucuda şifreli saklanır;
            her &quot;Göster&quot; işlemi denetim kaydına yazılır. KVKK aydınlatma metni: <span className="font-semibold">ofis tarafından belirlenecek (yer tutucu)</span>.
          </p>
          <PrivateEditor profileId={memberId} piiEnabled={piiEnabled()} provinces={provinces} defaults={priv.data} />
        </Section>
      ) : !canSeePrivate ? (
        <Alert tone="info">Kimlik ve kişisel bilgileri yalnız ofis sahibi, genel müdür ve kişinin kendisi görebilir.</Alert>
      ) : null}
    </div>
  );
}
