import Link from "next/link";
import { ArrowUpRight, Lightbulb, Undo2, Wand2, X } from "lucide-react";
import { loadNlNeighborhoods, loadNlProvincesAndDistricts } from "@/lib/nl-search/geo-source";
import { parseNlQuery, NL_GROUPS, NL_GROUP_LABELS, type NlGroup } from "@/lib/nl-search/parse";
import { NL_TARGET_LABEL, nlTargetHref, parseExcludeParam } from "@/lib/nl-search/href";

/**
 * "Ne anladım" paneli (F2). Kural tabanlı ayrıştırıcı (src/lib/nl-search) cümleyi filtreye çevirir;
 * her filtre ÇIPLAK ve düzenlenebilir chip olarak görünür: x ile kaldır, "geri al" ile geri getir.
 * Sonuç, mevcut listelerin filtre kontratı URL'sine gider. Yapay zekâ kullanılmaz.
 */

const EXAMPLES = [
  "Onikişubat 3+1 satılık 2 milyon altı",
  "Kadıköy kiralık 2+1 30 bin altı",
  "Çankaya villa 5 milyon üstü",
  "İstanbul 100-150 m2 satılık daire",
];

function pageHref(q: string, haric: NlGroup[]): string {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (haric.length) p.set("haric", haric.join(","));
  const s = p.toString();
  return s ? `/app/arama-sonuclari?${s}` : "/app/arama-sonuclari";
}

export async function NlPanel({ q, haric }: { q: string; haric?: string }) {
  if (q.length < 2) {
    return (
      <section className="rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
        <p className="flex items-center gap-2 text-xs font-semibold text-text-muted">
          <Wand2 className="h-3.5 w-3.5 text-brand-600" /> Doğal dille arayın
        </p>
        <p className="mt-1 text-xs text-text-muted">
          Yazdığınız cümleyi filtreye çeviririm ve ne anladığımı gösteririm. Örnekler:
        </p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {EXAMPLES.map((s) => (
            <Link
              key={s}
              href={pageHref(s, [])}
              className="focus-ring press rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600"
            >
              {s}
            </Link>
          ))}
        </div>
      </section>
    );
  }

  const exclude = parseExcludeParam(haric, NL_GROUPS);
  const geo = await loadNlProvincesAndDistricts();
  const probe = parseNlQuery(q, geo);
  const districtId = [...probe.chips, ...probe.excluded].find((c) => c.group === "ilce")?.params.ilce;
  const neighborhoods = districtId ? await loadNlNeighborhoods(districtId) : undefined;
  const result = parseNlQuery(q, { ...geo, neighborhoods }, { exclude });

  if (result.chips.length === 0 && result.excluded.length === 0) {
    // Cümle hiçbir filtreye çevrilemedi: panel yok, normal metin araması sürer.
    return null;
  }

  const { href, unsupported } = nlTargetHref(result);
  const unsupportedGroups = new Set(unsupported.map((c) => c.group));
  const usable = result.chips.length - unsupported.length;

  return (
    <section
      aria-label="Ne anladım"
      className="rounded-[var(--radius-card)] border border-brand-200 bg-brand-50/40 p-4 shadow-[var(--shadow-xs)]"
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink-950">
          <Wand2 className="h-4 w-4 text-brand-600" /> Ne anladım
        </p>
        <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-semibold text-text-muted ring-1 ring-line">
          Kural tabanlı, yapay zekâ değil
        </span>
      </div>

      <ul className="mt-3 flex flex-wrap items-center gap-2">
        {result.chips.map((c) => (
          <li key={c.group}>
            <Link
              href={pageHref(q, [...exclude, c.group])}
              title={`${NL_GROUP_LABELS[c.group]} filtresini kaldır`}
              className={`focus-ring press inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition hover:border-danger-500 ${
                unsupportedGroups.has(c.group)
                  ? "border-dashed border-line bg-surface text-text-muted"
                  : "border-brand-300 bg-surface text-brand-700"
              }`}
            >
              <span className="text-text-faint">{NL_GROUP_LABELS[c.group]}:</span> {c.label}
              {c.assumed ? <span className="font-normal text-amber-600">(varsayım)</span> : null}
              <X className="h-3 w-3" aria-hidden />
              <span className="sr-only">kaldır</span>
            </Link>
          </li>
        ))}
        {result.excluded.map((c) => (
          <li key={`x-${c.group}`}>
            <Link
              href={pageHref(q, exclude.filter((g) => g !== c.group))}
              className="focus-ring press inline-flex items-center gap-1.5 rounded-full border border-dashed border-line px-3 py-1.5 text-xs text-text-faint line-through transition hover:text-brand-600"
            >
              {NL_GROUP_LABELS[c.group]}: {c.label}
              <Undo2 className="h-3 w-3 no-underline" aria-hidden />
              <span className="sr-only">geri al</span>
            </Link>
          </li>
        ))}
      </ul>

      {result.notes.length > 0 ? (
        <ul className="mt-2 space-y-0.5 text-xs text-amber-700">
          {result.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
      {result.unknown.length > 0 ? (
        <p className="mt-2 text-xs text-text-muted">
          Anlaşılamayan sözcükler filtreye çevrilmedi:{" "}
          <span className="font-semibold text-ink-950">{result.unknown.join(", ")}</span>
        </p>
      ) : null}
      {unsupported.length > 0 ? (
        <p className="mt-2 text-xs text-text-muted">
          {NL_TARGET_LABEL[result.target]} listesi kesikli çizgili filtreleri desteklemiyor; yalnız diğerleri uygulanır.
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link
          href={href}
          className="focus-ring press inline-flex min-h-[40px] items-center gap-1.5 rounded-[var(--radius-control)] bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          {NL_TARGET_LABEL[result.target]} listesinde göster ({usable > 0 ? `${usable} filtre` : "filtresiz"})
          <ArrowUpRight className="h-4 w-4" />
        </Link>
        <p className="flex items-center gap-1.5 text-xs text-text-muted">
          <Lightbulb className="h-3.5 w-3.5 text-amber-600" /> Çipe tıklayarak filtreyi kaldırabilirsiniz; metin araması aşağıda sürer.
        </p>
      </div>
    </section>
  );
}
