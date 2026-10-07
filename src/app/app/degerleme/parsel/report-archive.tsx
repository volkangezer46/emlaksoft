import Link from "@/components/ui/smart-link";
import { Clock, FileText, Info } from "lucide-react";
import { now } from "@/lib/clock";
import { formatDateTimeTr } from "@/lib/format";
import { guvenEtiketi } from "@/lib/ef-credits/present";
import type { EfReportRow } from "@/lib/ef-credits/types";
import {
  EF_PDF_DEADLINE_WARNING,
  EF_REPORT_VALID_DAYS,
  cleanDay,
  cleanTip,
  filterReports,
  pdfStatusOf,
  reportValidity,
  validityLabel,
} from "@/lib/ef-credits/visibility";

export type ArchiveParams = { rapor_bas?: string; rapor_bit?: string; rapor_tip?: string; rapor_kullanici?: string };

const BASE = "/app/degerleme/parsel";

function archiveHref(p: ArchiveParams): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v) sp.set(k, v);
  const q = sp.toString();
  return `${BASE}${q ? `?${q}` : ""}#gecmis-raporlar`;
}

/** Rapor arşivi: görünürlük (kendi raporu + owner/gm) sunucuda uygulanmış `reports` gelir; burada yalnız süzgeç + gösterim. */
export function ReportArchive({
  reports,
  params,
  canSeeAll,
  userNames,
}: {
  reports: EfReportRow[] | null;
  params: ArchiveParams;
  /** owner/gm: kullanıcı süzgeci + "kim yaptı" sütunu. */
  canSeeAll: boolean;
  userNames: Record<string, string>;
}) {
  const nowMs = now();
  const from = cleanDay(params.rapor_bas);
  const to = cleanDay(params.rapor_bit);
  const tip = cleanTip(params.rapor_tip);
  const userId = canSeeAll ? params.rapor_kullanici || null : null;
  const all = reports ?? [];
  const rows = filterReports(all, { from, to, tip, userId });
  const filtered = Boolean(from || to || tip || userId);
  const authors = canSeeAll
    ? [...new Set(all.map((r) => r.user_id).filter((v): v is string => !!v))]
    : [];
  const active = rows.filter((r) => !reportValidity(r, nowMs).expired).length;

  return (
    <section id="gecmis-raporlar" className="scroll-mt-24 rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
        <FileText className="h-4 w-4 text-brand-600" aria-hidden="true" /> Rapor arşivi
      </h2>
      <p className="mt-1 text-xs text-text-muted">
        {canSeeAll ? "Ofisinizin tüm ada/parsel raporları." : "Yalnızca sizin hazırladığınız raporlar."} Raporlar {EF_REPORT_VALID_DAYS} gün geçerlidir.
      </p>
      <p role="note" className="mt-3 flex items-start gap-2 rounded-[var(--radius-card)] border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs font-medium text-amber-700">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {EF_PDF_DEADLINE_WARNING}
      </p>

      <form method="get" action={`${BASE}#gecmis-raporlar`} className="mt-4 flex flex-wrap items-end gap-3" aria-label="Rapor süzgeci">
        <label className="text-xs font-semibold text-text-muted">
          Başlangıç
          <input type="date" name="rapor_bas" defaultValue={from ?? ""} className="focus-ring mt-1 block rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 py-1.5 text-sm text-ink-950" />
        </label>
        <label className="text-xs font-semibold text-text-muted">
          Bitiş
          <input type="date" name="rapor_bit" defaultValue={to ?? ""} className="focus-ring mt-1 block rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 py-1.5 text-sm text-ink-950" />
        </label>
        <label className="text-xs font-semibold text-text-muted">
          Tür
          <select name="rapor_tip" defaultValue={tip ?? ""} className="focus-ring mt-1 block rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 py-1.5 text-sm text-ink-950">
            <option value="">Hepsi</option>
            <option value="arsa">Arsa</option>
            <option value="konut">Konut</option>
          </select>
        </label>
        {canSeeAll ? (
          <label className="text-xs font-semibold text-text-muted">
            Kullanıcı
            <select name="rapor_kullanici" defaultValue={userId ?? ""} className="focus-ring mt-1 block rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 py-1.5 text-sm text-ink-950">
              <option value="">Tüm kullanıcılar</option>
              {authors.map((id) => (
                <option key={id} value={id}>{userNames[id] ?? "Kullanıcı"}</option>
              ))}
            </select>
          </label>
        ) : null}
        <button type="submit" className="focus-ring press min-h-9 rounded-[var(--radius-control)] bg-ink-950 px-3.5 py-1.5 text-sm font-semibold text-white">
          Süz
        </button>
        {filtered ? (
          <Link href={archiveHref({})} className="focus-ring text-sm font-semibold text-brand-600 hover:underline">
            Süzgeci temizle
          </Link>
        ) : null}
      </form>

      {reports === null || all.length === 0 ? (
        <p className="mt-4 rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-8 text-center text-sm text-text-muted">
          Henüz ada/parsel raporu yok. Yukarıdan ilk değerlemenizi yapın; rapor burada listelenir.
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-4 rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-8 text-center text-sm text-text-muted">
          Bu süzgece uyan rapor yok.{" "}
          <Link href={archiveHref({})} className="font-semibold text-brand-600 hover:underline">Tüm raporları göster</Link>
        </p>
      ) : (
        <>
          <p className="mt-4 text-xs text-text-muted">
            {rows.length} rapor{rows.length !== active ? ` · ${active} tanesi hâlâ geçerli` : ""}
          </p>
          <ul className="mt-2 divide-y divide-line">
            {rows.map((r) => {
              const v = reportValidity(r, nowMs);
              const pdf = pdfStatusOf(r, v.expired);
              const body = (
                <>
                  <span className="min-w-0">
                    <span className="block font-semibold text-ink-950 group-hover:text-brand-600">
                      Ada {r.ada ?? "—"} / Parsel {r.parsel ?? "—"} · {r.tip === "konut" ? "Konut" : "Arsa"}
                    </span>
                    <span className="block text-xs text-text-muted">
                      {formatDateTimeTr(r.created_at)}
                      {canSeeAll ? ` · ${r.user_id ? (userNames[r.user_id] ?? "Kullanıcı") : "Bilinmiyor"}` : ""}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                    <span className="rounded-full bg-ink-950/6 px-2.5 py-0.5 text-text-muted">{guvenEtiketi(r.guven_sinifi)}</span>
                    <span className="rounded-full bg-ink-950/6 px-2.5 py-0.5 text-text-muted">{r.units_charged} kontör</span>
                    <span className={`rounded-full px-2.5 py-0.5 ${pdf.taken ? "bg-mint-500/10 text-mint-700" : "bg-ink-950/6 text-text-muted"}`}>{pdf.label}</span>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 ${
                        v.expired ? "bg-danger-500/10 text-danger-600" : (v.daysLeft ?? 99) <= 7 ? "bg-amber-400/15 text-amber-700" : "bg-brand-600/10 text-brand-600"
                      }`}
                    >
                      <Clock className="h-3 w-3" aria-hidden="true" /> {validityLabel(v)}
                    </span>
                  </span>
                </>
              );
              return (
                <li key={r.rapor_id}>
                  <Link
                    href={`${BASE}/rapor/${r.rapor_id}`}
                    className={`focus-ring group flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] px-2 py-3 transition hover:bg-brand-600/[0.03] ${v.expired ? "opacity-80" : ""}`}
                  >
                    {body}
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
