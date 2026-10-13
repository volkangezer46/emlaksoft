import { notFound } from "next/navigation";
import Link from "@/components/ui/smart-link";
import { ArrowLeft, ExternalLink, FileText } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { toTrLocalInput } from "@/lib/clock";
import { getSupportContact } from "@/lib/contact-info-server";
import { legalEntityFields } from "@/lib/legal-entity";
import { diffLines, diffStats, isLegalDocSlug, legalDocTitle, lintLegalMarkup } from "@/lib/legal-docs/core";
import { readLegalDocVersions, readRecentConsents } from "@/lib/legal-docs/store";
import { requirePlatformModule } from "@/lib/platform";
import { LegalDocEditor, VersionActions } from "./legal-doc-editor";

export const metadata = { title: "Yasal belge düzenleme" };

const fmt = (iso: string | null) => (iso ? toTrLocalInput(iso).replace("T", " ") : "—");
const DIFF_TONE = { same: "text-text-muted", add: "bg-mint-500/12 text-mint-800", del: "bg-danger-500/10 text-danger-600 line-through" } as const;

/**
 * Tek yasal belge: taslak düzenleyici (canlı önizleme), kaydedilmiş taslak ile yayındaki metnin satır farkı, sürüm
 * geçmişi (bu sürüme dön / koda dön) ve son onay kayıtları (yalnız süper admin; IP kanıt amaçlı).
 */
export default async function LegalDocPage({ params }: { params: Promise<{ slug: string }> }) {
  const [staff, { slug }] = await Promise.all([requirePlatformModule("sistem"), params]);
  if (!isLegalDocSlug(slug)) notFound();
  const canEdit = staff.role === "super_admin";
  const [versions, contact, entity, consents] = await Promise.all([
    readLegalDocVersions(slug),
    getSupportContact(),
    legalEntityFields(),
    canEdit ? readRecentConsents(slug) : Promise.resolve(null),
  ]);
  const rows = versions.status === "ok" ? versions.rows : [];
  const draft = rows.find((r) => r.status === "draft") ?? null;
  const live = rows.find((r) => r.status === "published") ?? null;
  const diff = draft ? diffLines(live?.body ?? "", draft.body) : null;
  const stats = diff ? diffStats(diff) : null;
  const issues = draft ? lintLegalMarkup(draft.body) : [];

  return (
    <div className="space-y-6">
      <Link href="/admin/ayarlar/yasal" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-text-muted hover:text-brand-600">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Yasal belgeler
      </Link>
      <AdminPageHeader
        eyebrow="Yasal belge"
        icon={FileText}
        title={legalDocTitle(slug)}
        description={live ? `Yayında v${live.version} (${fmt(live.publishedAt)}).` : "Yayında koddaki metin (v1) var; ilk DB sürümü v2 olur."}
        actions={
          <a href={`/${slug}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline">
            Sayfayı aç <ExternalLink className="h-4 w-4" aria-hidden />
          </a>
        }
      />

      {versions.status === "missing" ? (
        <p className="rounded-[var(--radius-card)] border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Sürümlü yasal belge tabloları henüz kurulmadı (migration 20261013005100 bekliyor). Sayfa koddaki metinle yayında.
        </p>
      ) : (
        <LegalDocEditor
          key={draft ? `taslak:${draft.version}` : live ? `yayin:${live.version}` : "bos"}
          slug={slug}
          canEdit={canEdit}
          hasLive={Boolean(live)}
          draft={draft ? { version: draft.version, title: draft.title, intro: draft.intro, body: draft.body, requiresReconsent: draft.requiresReconsent, changeNote: draft.changeNote ?? "" } : null}
          seed={live ? { title: live.title, intro: live.intro, body: live.body } : null}
          contact={contact}
          entity={entity}
          issues={issues}
        />
      )}

      {diff && stats ? (
        <section aria-labelledby="fark-baslik" className="space-y-2">
          <h2 id="fark-baslik" className="text-base font-semibold text-ink-950">
            Kaydedilmiş taslak ile {live ? `yayındaki v${live.version}` : "boş metin"} arasındaki fark
          </h2>
          <p className="text-xs text-text-muted">
            {stats.added} satır eklendi, {stats.removed} satır çıkarıldı. Koddaki v1 metni burada karşılaştırılamaz; &quot;Yayındaki metinden taslak başlat&quot; ile başlarsanız fark yalnız sizin değişikliklerinizi gösterir.
          </p>
          <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap rounded-[var(--radius-card)] border border-line bg-surface p-3 text-xs leading-relaxed">
            {diff.map((l, i) => (
              <span key={i} className={`block ${DIFF_TONE[l.op]}`}>
                {l.op === "add" ? "+ " : l.op === "del" ? "- " : "  "}
                {l.text || " "}
              </span>
            ))}
          </pre>
        </section>
      ) : null}

      {rows.some((r) => r.status !== "draft") ? (
        <section aria-labelledby="gecmis-baslik" className="space-y-2">
          <h2 id="gecmis-baslik" className="text-base font-semibold text-ink-950">
            Sürüm geçmişi
          </h2>
          <TableFrame minWidth={640}>
            <Table>
              <caption className="sr-only">Yayınlanmış ve arşivlenmiş sürümler</caption>
              <THead>
                <TR>
                  <TH>Sürüm</TH>
                  <TH>Yayın</TH>
                  <TH>Değişiklik notu</TH>
                  <TH align="right">İşlem</TH>
                </TR>
              </THead>
              <TBody>
                {rows
                  .filter((r) => r.status !== "draft")
                  .map((r) => (
                    <TR key={r.id}>
                      <TD className="font-semibold text-ink-950">
                        v{r.version}
                        <span className="ml-2 text-xs font-normal text-text-muted">{r.status === "published" ? "yayında" : "arşiv"}</span>
                        {r.requiresReconsent ? <span className="ml-2 rounded-full bg-brand-600/10 px-2 py-0.5 text-xs font-bold text-brand-700">yeniden onay</span> : null}
                      </TD>
                      <TD className="text-sm">{fmt(r.publishedAt)}</TD>
                      <TD className="max-w-sm text-xs text-text-muted">{r.changeNote ?? "—"}</TD>
                      <TD align="right">
                        {canEdit ? <VersionActions slug={slug} version={r.version} live={r.status === "published"} hasDraft={Boolean(draft)} /> : null}
                      </TD>
                    </TR>
                  ))}
              </TBody>
            </Table>
          </TableFrame>
        </section>
      ) : null}

      {consents && consents.length ? (
        <section aria-labelledby="onay-baslik" className="space-y-2">
          <h2 id="onay-baslik" className="text-base font-semibold text-ink-950">
            Son onay kayıtları
          </h2>
          <p className="text-xs text-text-muted">Yeniden onay penceresinden gelen son 50 kayıt (kullanıcı, sürüm, sunucu zamanı, IP). Kanıt amaçlıdır.</p>
          <TableFrame minWidth={560}>
            <Table>
              <caption className="sr-only">Yeniden onay kayıtları</caption>
              <THead>
                <TR>
                  <TH>Kullanıcı</TH>
                  <TH>Sürüm</TH>
                  <TH>Zaman</TH>
                  <TH>IP</TH>
                </TR>
              </THead>
              <TBody>
                {consents.map((c) => (
                  <TR key={`${c.userId}:${c.version}`}>
                    <TD>
                      <Link href={`/admin/members/${c.userId}`} className="font-mono text-xs text-brand-600 hover:underline">
                        {c.userId.slice(0, 8)}
                      </Link>
                    </TD>
                    <TD>v{c.version}</TD>
                    <TD className="text-sm">{fmt(c.acceptedAt)}</TD>
                    <TD className="font-mono text-xs">{c.ip ?? "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableFrame>
        </section>
      ) : null}
    </div>
  );
}
