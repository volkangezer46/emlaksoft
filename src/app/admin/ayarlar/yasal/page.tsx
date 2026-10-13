import Link from "@/components/ui/smart-link";
import { ArrowRight, Scale } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { RegistrySettings } from "@/components/settings/registry-settings";
import { FilterChip } from "@/components/ui/filter-chip";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { trDayKey, toTrLocalInput } from "@/lib/clock";
import { allLegalConstants, DATED_LEGAL_KEYS, formatLegalValue, LEGAL_CONSTANTS, type LegalConstant, type LegalKey } from "@/lib/legal-constants";
import { activeRecord, nextScheduled } from "@/lib/legal-constants/history";
import { readLegalConstantHistory } from "@/lib/legal-constants/store";
import { LEGAL_DOCS } from "@/lib/legal-docs/core";
import { readLegalOverview } from "@/lib/legal-docs/store";
import { requirePlatformModule } from "@/lib/platform";
import { LEGAL_ENTITY_KEYS, SUPPORT_CONTACT_KEYS } from "@/lib/settings/registry/legal";
import { ConstantEditor, FutureConstantList } from "./constant-editor";
import { CodeSnapshotButton } from "./snapshot-button";

export const metadata = { title: "Yasal metinler, şirket kimliği ve mevzuat sabitleri" };

const TABS = [
  { id: "belgeler", label: "Belgeler" },
  { id: "sirket", label: "Şirket" },
  { id: "sabitler", label: "Sabitler" },
  { id: "form", label: "Form metinleri" },
] as const;
type Tab = (typeof TABS)[number]["id"];

const tabHref = (t: Tab) => (t === "belgeler" ? "/admin/ayarlar/yasal" : `/admin/ayarlar/yasal?sekme=${t}`);
const fmt = (iso: string) => toTrLocalInput(iso).replace("T", " ");

/**
 * Koda dokunmadan yasal içerik (AD12): Belgeler (8 yasal sayfa, sürümlü taslak > yayın, yeniden onay), Şirket (ünvan,
 * adres, MERSİS, vergi, KEP, telefon ve destek iletişimi; ayar defteri), Sabitler (mevzuat sabitlerinin geçerlilik
 * tarihli geçmişi) ve başvuru formu metinleri. Okuma: modül `sistem`; yazma yalnız süper admin. Hukuki/mali danışmanlık
 * değildir; metin sorumluluğu şirket sahibindedir.
 */
export default async function LegalSettingsPage({ searchParams }: { searchParams: Promise<{ sekme?: string }> }) {
  const [staff, sp] = await Promise.all([requirePlatformModule("sistem"), searchParams]);
  const tab: Tab = TABS.find((t) => t.id === sp.sekme)?.id ?? "belgeler";
  const canEdit = staff.role === "super_admin";

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="Ayarlar"
        icon={Scale}
        title="Yasal metinler ve şirket kimliği"
        description="Yasal sayfalar, şirket bilgileri ve mevzuat sabitleri buradan değişir; yayın anında sitede görünür, deploy gerekmez. Her değişiklik geçmişe yazılır."
      />
      <nav aria-label="Yasal ayar bölümleri" className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <FilterChip key={t.id} href={tabHref(t.id)} active={t.id === tab}>
            {t.label}
          </FilterChip>
        ))}
      </nav>

      {tab === "belgeler" ? <DocumentsTab canEdit={canEdit} /> : null}
      {tab === "sirket" ? (
        <div className="space-y-8">
          <RegistrySettings
            id="sirket"
            title="Şirket kimliği"
            description="Mesafeli satış sözleşmesi, ön bilgilendirme formu ve abonelik faturası başlığında görünür. Boş alan gösterilmez; bilgi uydurulmaz."
            keys={LEGAL_ENTITY_KEYS}
            canEdit={canEdit}
          />
          <RegistrySettings
            id="destek"
            title="Destek iletişimi"
            description="Yasal sayfalar ve askıya alınmış hesap ekranında görünen destek e-postası ve isteğe bağlı telefon/WhatsApp hatları."
            keys={SUPPORT_CONTACT_KEYS}
            canEdit={canEdit}
          />
        </div>
      ) : null}
      {tab === "sabitler" ? <ConstantsTab canEdit={canEdit} /> : null}
      {tab === "form" ? (
        <RegistrySettings
          id="metinler"
          title="Başvuru formu metinleri"
          description="Ofislerin herkese açık başvuru formunda gösterilir. Varsayılan metin koddaki değerdir; Varsayılana dön ile geri alınır."
          keys={["legal.lead_consent_text", "legal.lead_notice_text", "legal.lead_marketing_text"]}
          canEdit={canEdit}
        />
      ) : null}
    </div>
  );
}

async function DocumentsTab({ canEdit }: { canEdit: boolean }) {
  const overview = await readLegalOverview().catch(() => ({ status: "error" as const, error: "okunamadı" }));
  if (overview.status === "missing") {
    return (
      <p className="rounded-[var(--radius-card)] border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        Sürümlü yasal belge tabloları henüz kurulmadı (migration 20261013005100 bekliyor). Sayfalar koddaki metinle yayında.
      </p>
    );
  }
  const rows = overview.status === "ok" ? overview.rows : [];
  // Taşıma: yayında DB sürümü ve v1 kaydı olmayan belge varsa koddaki metin tek tıkla arşiv v1 olarak kaydedilir.
  const needsSnapshot = overview.status === "ok" && LEGAL_DOCS.some((d) => !rows.some((r) => r.slug === d.slug && (r.status === "published" || r.version === 1)));
  return (
    <section aria-labelledby="belgeler-baslik" className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
        <h2 id="belgeler-baslik" className="text-base font-semibold text-ink-950">
          Yasal belgeler
        </h2>
        <p className="text-xs text-text-muted">
          Yayında DB sürümü yoksa sayfa koddaki metni (v1) gösterir. Taslak yayına alınana kadar sitede görünmez.
          {overview.status === "error" ? " Sürüm bilgisi şu an okunamadı." : ""}
          {needsSnapshot ? " Koddaki metni v1 olarak kaydederseniz farklar v1'e göre görünür ve v1, belge sayfasından DB sürümü olarak yayınlanabilir." : ""}
        </p>
        </div>
        {canEdit && needsSnapshot ? <CodeSnapshotButton /> : null}
      </div>
      <TableFrame minWidth={720}>
        <Table>
          <caption className="sr-only">Yasal belgeler, yayındaki sürüm ve bekleyen taslak</caption>
          <THead>
            <TR>
              <TH>Belge</TH>
              <TH>Yayındaki sürüm</TH>
              <TH>Taslak</TH>
              <TH align="right">İşlem</TH>
            </TR>
          </THead>
          <TBody>
            {LEGAL_DOCS.map((d) => {
              const mine = rows.filter((r) => r.slug === d.slug);
              const live = mine.find((r) => r.status === "published");
              const draft = mine.find((r) => r.status === "draft");
              return (
                <TR key={d.slug}>
                  <TD>
                    <Link href={`/admin/ayarlar/yasal/${d.slug}`} className="font-semibold text-ink-950 hover:text-brand-600">
                      {d.title}
                    </Link>
                    <span className="block text-xs text-text-muted">/{d.slug}</span>
                  </TD>
                  <TD className="text-sm">
                    {live ? (
                      <>
                        v{live.version}
                        {live.publishedAt ? <span className="block text-xs text-text-muted">{fmt(live.publishedAt)}</span> : null}
                        {live.requiresReconsent ? <span className="mt-1 inline-block rounded-full bg-brand-600/10 px-2 py-0.5 text-xs font-bold text-brand-700">Yeniden onay istendi</span> : null}
                      </>
                    ) : (
                      <span className="text-text-muted">
                        Koddaki metin (v1)
                        {mine.some((r) => r.version === 1) ? <span className="block text-xs">v1 DB&apos;de kayıtlı</span> : null}
                      </span>
                    )}
                  </TD>
                  <TD className="text-sm">
                    {draft ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">v{draft.version} bekliyor</span>
                    ) : (
                      <span className="text-text-muted">Yok</span>
                    )}
                  </TD>
                  <TD align="right">
                    <Link
                      href={`/admin/ayarlar/yasal/${d.slug}`}
                      className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand-600 hover:underline"
                    >
                      Düzenle <ArrowRight className="h-4 w-4" aria-hidden />
                    </Link>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </TableFrame>
    </section>
  );
}

async function ConstantsTab({ canEdit }: { canEdit: boolean }) {
  const today = trDayKey();
  const history = await readLegalConstantHistory().catch(() => ({ status: "error" as const, error: "okunamadı" }));
  const records = history.status === "ok" ? history.records : [];
  const display = new Map(allLegalConstants().map((c) => [c.key, c]));
  const keys = Object.keys(LEGAL_CONSTANTS) as LegalKey[];
  const options = keys.map((k) => ({ key: k, label: (LEGAL_CONSTANTS[k] as LegalConstant).label, unit: (LEGAL_CONSTANTS[k] as LegalConstant).unit }));

  return (
    <section aria-labelledby="sabitler-baslik" className="space-y-4">
      <div>
        <h2 id="sabitler-baslik" className="text-base font-semibold text-ink-950">
          Mevzuat sabitleri
        </h2>
        <p className="text-xs text-text-muted">
          Her değişiklik geçerlilik tarihiyle eklenir; geçmiş silinmez. Geleceğe tarihli değer o güne kadar uygulanmaz. Yürürlükteki değer
          o gün hesaplayıcılara (alım maliyeti, satıcı net hesabı) en geç 5 dakikada yansır. &quot;Yalnız kayıt&quot; işaretli sabitler
          (kredi sınırları, yabancıya satış eşikleri vb.) koddaki değerle çalışır; yürürlükteki değer farklıysa geliştiriciye
          iletilmelidir (docs/MEVZUAT_SABITLERI.md).
        </p>
      </div>
      {history.status === "missing" ? (
        <p className="rounded-[var(--radius-card)] border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Tarihli değer tablosu henüz kurulmadı (migration 20261013005100 bekliyor). Değerler koddaki sabittir.
        </p>
      ) : null}
      {canEdit && history.status === "ok" ? <ConstantEditor options={options} today={today} /> : null}
      <TableFrame minWidth={820}>
        <Table>
          <caption className="sr-only">Mevzuat sabitleri: kod değeri, yürürlükteki değer, planlanan değişiklik ve geçmiş</caption>
          <THead>
            <TR>
              <TH>Sabit</TH>
              <TH align="right">Kod değeri</TH>
              <TH align="right">Yürürlükte</TH>
              <TH>Planlanan</TH>
              <TH>Kaynak / durum</TH>
            </TR>
          </THead>
          <TBody>
            {keys.map((k) => {
              const c = LEGAL_CONSTANTS[k] as LegalConstant;
              const d = display.get(k);
              const active = activeRecord(k, records, today);
              const next = nextScheduled(k, records, today);
              const mine = records.filter((r) => r.key === k);
              const differs = active && active.value !== c.value;
              return (
                <TR key={k}>
                  <TD>
                    <span className="block font-semibold text-ink-950">{c.label}</span>
                    {mine.length ? (
                      <details className="mt-1 text-xs text-text-muted">
                        <summary className="cursor-pointer">Geçmiş ({mine.length} kayıt)</summary>
                        <ul className="mt-1 space-y-0.5">
                          {mine.map((r) => (
                            <li key={r.validFrom}>
                              {r.validFrom}: {formatLegalValue(r.value, c.unit)}
                              {r.source ? ` · ${r.source}` : ""}
                              {r.note ? ` · ${r.note}` : ""}
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </TD>
                  <TD align="right" className="whitespace-nowrap">{formatLegalValue(c.value, c.unit)}</TD>
                  <TD align="right" className="whitespace-nowrap font-semibold text-ink-950">
                    {active ? formatLegalValue(active.value, c.unit) : formatLegalValue(c.value, c.unit)}
                    {active ? <span className="block text-xs font-normal text-text-muted">{active.validFrom} itibarıyla</span> : null}
                    {DATED_LEGAL_KEYS.includes(k) ? (
                      <span className="block text-xs font-normal text-mint-700">Hesaplayıcıya uygulanır</span>
                    ) : (
                      <span className="block text-xs font-normal text-text-muted">Yalnız kayıt</span>
                    )}
                    {differs && !DATED_LEGAL_KEYS.includes(k) ? <span className="block text-xs font-bold text-amber-800">Koda işlenmeli</span> : null}
                  </TD>
                  <TD className="whitespace-nowrap text-sm">
                    {next ? (
                      <>
                        {formatLegalValue(next.value, c.unit)} <span className="text-text-muted">· {next.validFrom}</span>
                      </>
                    ) : (
                      <span className="text-text-muted">Yok</span>
                    )}
                  </TD>
                  <TD className="max-w-sm text-xs text-text-muted">
                    {c.source}
                    <span className={`ml-1 rounded-full px-2 py-0.5 font-bold ${d?.verified ? "bg-mint-500/15 text-mint-700" : "bg-amber-500/12 text-amber-800"}`}>
                      {d?.verified ? "Doğrulandı" : "Doğrulanmadı"}
                    </span>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </TableFrame>
      {canEdit && records.some((r) => r.validFrom > today) ? <FutureConstantList records={records.filter((r) => r.validFrom > today)} /> : null}
    </section>
  );
}
