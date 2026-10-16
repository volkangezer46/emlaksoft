import { notFound } from "next/navigation";
import Link from "@/components/ui/smart-link";
import { ArrowLeft, FileSearch, History, ShieldCheck, UserCheck } from "lucide-react";
import { requirePlatformModule } from "@/lib/platform";
import { createAdminClient } from "@/lib/supabase/admin";
import { now } from "@/lib/clock";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { auditActionLabel } from "@/lib/admin-format";
import { formatPhoneDisplay } from "@/lib/phone";
import { kvkkDaysLeftLabel } from "@/lib/compliance/kvkk-queue";
import {
  IDENTITY_METHOD_LABELS,
  IDENTITY_STATUS_LABELS,
  PLATFORM_KVKK_STATUS_LABELS,
  PLATFORM_KVKK_TYPE_LABELS,
  RELATED_LABELS,
  defaultResponseText,
  erasureBlocker,
  packageBlocker,
  parsePackageSummary,
  platformKvkkDaysLeft,
  platformKvkkTone,
  respondBlocker,
  type IdentityMethod,
} from "@/lib/compliance/platform-kvkk";
import { loadPlatformKvkkRequest, type ErasureResult } from "@/lib/compliance/platform-kvkk-service";
import { KvkkRequestSteps } from "./request-steps";
import { KvkkScanRecords } from "./scan-records";

export const metadata = { title: "KVKK başvurusu" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fmt = (iso: string | null, withTime = false) =>
  iso
    ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", ...(withTime ? { timeStyle: "short" } : {}), timeZone: "Europe/Istanbul" }).format(new Date(iso))
    : "—";

const TONE_CLASS = {
  late: "bg-danger-500/10 text-danger-600",
  warn: "bg-amber-400/15 text-amber-800",
  ok: "bg-mint-500/10 text-mint-700",
  closed: "bg-[var(--surface-sunken)] text-text-muted",
} as const;

function Section({ title, icon: Icon, children, id }: { title: string; icon: typeof ShieldCheck; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="scroll-mt-24 space-y-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4 sm:p-5">
      <h2 className="flex items-center gap-2 font-display text-sm font-bold text-ink-950">
        <Icon className="h-4 w-4 text-brand-600" aria-hidden /> {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-2 py-1.5 text-sm">
      <dt className="text-xs font-semibold text-text-muted">{k}</dt>
      <dd className="min-w-0 break-words text-ink-950">{v}</dd>
    </div>
  );
}

type AuditRow = { id: string; created_at: string; action: string; actor_id: string | null; meta: Record<string, unknown> | null };

/**
 * KVKK BAŞVURU AYRINTISI (DG6): başvuru bilgisi, 30 gün sayacı, adımlar (kimlik → veri paketi → silme → yanıt + sonuç) ve
 * denetim izi. Kişi bilgisi yalnız bu sayfada (tickets modülü) görünür. Veri paketi DOSYASI burada verilmez: Raporlar >
 * "KVKK veri paketi" raporundan başvuru no ile alınır (rapor merkezi deseni; sayfalarda indirme/rapor bağlantısı yok).
 */
export default async function KvkkRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requirePlatformModule("tickets");
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  // service_role: platform başvurusu (tablo politikasız); kapı tickets modülü.
  const admin = createAdminClient();
  const [row, auditRes] = await Promise.all([
    loadPlatformKvkkRequest(admin, id),
    admin
      .from("platform_audit_logs")
      .select("id, created_at, action, actor_id, meta")
      .eq("entity_type", "kvkk_request")
      .eq("entity_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  if (!row || row.status === "awaiting_email") notFound();

  const audit = (auditRes.data ?? []) as AuditRow[];
  const staffIds = [...new Set([row.assignee_id, row.identity_checked_by, row.resolved_by, ...audit.map((a) => a.actor_id)].filter(Boolean))] as string[];
  const { data: staffRows } = staffIds.length ? await admin.from("platform_staff").select("id, full_name").in("id", staffIds) : { data: [] };
  const staffName = new Map(((staffRows ?? []) as { id: string; full_name: string }[]).map((s) => [s.id, s.full_name]));
  const who = (sid: string | null) => (sid ? staffName.get(sid) ?? "Personel" : "Başvuru sahibi");

  const nowMs = now();
  const daysLeft = platformKvkkDaysLeft(row.due_at, row.status, nowMs);
  const tone = platformKvkkTone(daysLeft);
  const summary = parsePackageSummary(row.package_summary);
  const erasure = (row.erasure_result ?? null) as ErasureResult | null;
  const closed = row.status === "completed" || row.status === "rejected";
  const found = summary ? summary.customers + summary.demoRequests + summary.visitors : 0;

  return (
    <div className="space-y-4">
      <Link href="/admin/tickets/kvkk?kaynak=basvuru" className="inline-flex min-h-9 items-center gap-1.5 text-xs font-semibold text-text-muted hover:text-ink-950 touch:min-h-11">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Doğrudan başvurular
      </Link>
      <AdminPageHeader
        art="shield"
        eyebrow="KVKK başvurusu"
        icon={ShieldCheck}
        title={row.ref}
        description={`${PLATFORM_KVKK_TYPE_LABELS[row.request_type] ?? row.request_type} · ${PLATFORM_KVKK_STATUS_LABELS[row.status as keyof typeof PLATFORM_KVKK_STATUS_LABELS] ?? row.status} · başvuru ${fmt(row.created_at)} · son tarih ${fmt(row.due_at)}`}
      />

      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums", TONE_CLASS[tone])}>
          {closed ? `Sonuçlandı · ${fmt(row.resolved_at)}` : kvkkDaysLeftLabel(daysLeft)}
        </span>
        <span className="text-xs text-text-muted">Sorumlu: {row.assignee_id ? who(row.assignee_id) : "atanmadı"}</span>
      </div>

      {tone === "late" ? (
        <Alert tone="danger" title="30 günlük yasal yanıt süresi geçti">
          KVKK m.13 uyarınca başvuru en geç 30 gün içinde sonuçlandırılmalıdır. Başvuruyu öncelikle sonuçlandırın.
        </Alert>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Section title="Başvuru" icon={UserCheck}>
          <dl className="divide-y divide-[var(--line)]">
            <Row k="Ad soyad" v={row.requester_name} />
            <Row k="E-posta" v={<span className="break-all">{row.email} <span className="text-xs text-mint-700">· doğrulandı {fmt(row.email_verified_at, true)}</span></span>} />
            <Row k="Telefon" v={row.phone ? formatPhoneDisplay(row.phone) : "—"} />
            <Row k="İlgili ofis" v={row.office_hint ?? "—"} />
            <Row k="Talep" v={<p className="whitespace-pre-wrap">{row.details}</p>} />
            <Row
              k="Kimlik"
              v={
                <>
                  {IDENTITY_STATUS_LABELS[row.identity_status as keyof typeof IDENTITY_STATUS_LABELS] ?? row.identity_status}
                  {row.identity_method ? ` · ${IDENTITY_METHOD_LABELS[row.identity_method as IdentityMethod] ?? row.identity_method}` : ""}
                  {row.identity_checked_at ? <span className="text-xs text-text-muted"> · {who(row.identity_checked_by)}, {fmt(row.identity_checked_at, true)}</span> : null}
                  {row.identity_note ? <p className="mt-1 text-xs text-text-muted">{row.identity_note}</p> : null}
                </>
              }
            />
          </dl>
        </Section>

        <Section title="Bulunan kayıtlar" icon={FileSearch} id="kayitlar">
          {!summary ? (
            <p className="text-xs text-text-muted">
              Kimlik doğrulandıktan sonra &quot;Kayıtları tara&quot; ile kişinin doğrulanmış e-posta adresi ve yazdığı telefonla eşleşen kayıtlar (ofis
              müşteri kayıtları, EmlakSoft demo talepleri, açık ev ziyaretçi kayıtları) bulunur. Ad ile eşleştirme yapılmaz; yalnız telefonla eşleşen
              kayıtlar siz onaylamadan veri paketine ve silmeye girmez.
            </p>
          ) : (
            <>
              <p className="text-sm text-ink-950">
                {found > 0 ? (
                  <>
                    <b>{found}</b> kayıt kapsamda
                    {summary.offices > 0 ? ` · ${summary.offices} ofis` : ""} · taranma {fmt(row.package_prepared_at, true)}
                  </>
                ) : (
                  <>Kapsamda kayıt yok · taranma {fmt(row.package_prepared_at, true)}</>
                )}
                {summary.phoneCandidates > 0 ? <span className="text-amber-800"> · {summary.phoneCandidates} telefon eşleşmesi onay bekliyor</span> : null}
              </p>
              <ul className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                <li className="rounded-[var(--radius-control)] border border-line px-2.5 py-1.5">Ofis müşteri kaydı: <b>{summary.customers}</b></li>
                <li className="rounded-[var(--radius-control)] border border-line px-2.5 py-1.5">Demo talebi: <b>{summary.demoRequests}</b></li>
                <li className="rounded-[var(--radius-control)] border border-line px-2.5 py-1.5">Açık ev kaydı: <b>{summary.visitors}</b></li>
                {Object.entries(summary.related).map(([k, n]) => (
                  <li key={k} className="rounded-[var(--radius-control)] border border-line px-2.5 py-1.5">
                    {RELATED_LABELS[k] ?? k}: <b>{n}</b>
                  </li>
                ))}
              </ul>
              <KvkkScanRecords
                id={row.id}
                records={summary.records}
                approved={summary.approvedPhone}
                editable={!closed && !row.erasure_applied_at && row.identity_status === "verified"}
              />
              {summary.legalHolds.length ? (
                <div className="rounded-[var(--radius-control)] border border-amber-400/40 bg-amber-400/10 p-3 text-xs text-ink-950">
                  <p className="font-semibold">Yasal saklama nedeniyle silinmeyecek kayıtlar</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {summary.legalHolds.map((h) => (
                      <li key={h}>{h}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p className="text-xs text-text-muted">
                Veri paketi dosyası: Raporlar &gt; Rapor merkezi &gt; &quot;KVKK veri paketi&quot; raporunu <b>{row.ref}</b> başvuru no ile açın (XLSX/PDF/CSV).
              </p>
            </>
          )}
          {erasure ? (
            <div className="rounded-[var(--radius-control)] border border-line bg-surface-sunken p-3 text-xs">
              <p className="font-semibold text-ink-950">
                Silme sonucu ({fmt(erasure.at, true)}): {erasure.anonymized} müşteri kaydı anonimleşti
                {erasure.already ? `, ${erasure.already} kayıt zaten anonimdi` : ""}
                {erasure.gone ? `, ${erasure.gone} kayıt ofiste artık yok` : ""}
                {erasure.demoRequests ? `, ${erasure.demoRequests} demo talebi` : ""}
                {erasure.visitors ? `, ${erasure.visitors} açık ev kaydı` : ""}.
              </p>
              {erasure.failed.length ? (
                <ul className="mt-1 list-disc pl-4 text-danger-600">
                  {erasure.failed.map((f, i) => (
                    <li key={i}>
                      {f.office}: {f.reason}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </Section>
      </div>

      <KvkkRequestSteps
        id={row.id}
        refNo={row.ref}
        type={row.request_type}
        closed={closed}
        identityStatus={row.identity_status}
        assignedToMe={row.assignee_id === staff.id}
        packageBlock={packageBlocker(row)}
        erasureBlock={erasureBlocker(row)}
        completeBlock={respondBlocker(row, "completed")}
        isErasure={row.request_type === "erasure"}
        erasureDone={Boolean(row.erasure_applied_at)}
        packageDone={Boolean(row.package_prepared_at)}
        defaultCompleted={defaultResponseText(row.request_type, "completed", summary)}
        defaultRejected={defaultResponseText(row.request_type, "rejected", summary)}
        response={
          closed
            ? {
                text: row.response_text ?? "",
                at: fmt(row.resolved_at, true),
                by: who(row.resolved_by),
                delivery: row.response_delivery === "sent" ? `E-postayla gönderildi (${fmt(row.response_sent_at, true)})` : "Başka kanalla iletildi",
              }
            : null
        }
      />

      <Section title="Denetim izi" icon={History}>
        {audit.length === 0 ? (
          <p className="text-xs text-text-muted">Bu başvuru için denetim kaydı yok.</p>
        ) : (
          <ol className="space-y-1.5">
            {audit.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                <span className="tabular-nums text-text-muted">{fmt(a.created_at, true)}</span>
                <span className="font-semibold text-ink-950">{auditActionLabel(a.action)}</span>
                <span className="text-text-muted">· {a.actor_id ? who(a.actor_id) : "Başvuru sahibi / sistem"}</span>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}
