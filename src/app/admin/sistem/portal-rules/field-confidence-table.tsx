import Link from "@/components/ui/smart-link";
import { Badge } from "@/components/ui/badge";
import { relativeTimeTR } from "@/lib/admin-format";
import type { TransferPortal } from "@/lib/portal-transfer/rules";
import {
  CONFIDENCE_LABELS,
  CONFIDENCE_TONES,
  FIELD_STATE_LABELS,
  FIELD_STATE_TONES,
  confidenceBucket,
  fieldLabel,
  fieldStateOf,
  formatConfidence,
  formatPercent,
  portalRulesHref,
  type Overview,
} from "@/lib/portal-rules/admin-model";

export type SetField = { key: string; state: unknown; confidence: number; labels: string[] };

/**
 * Yayındaki setin alanları + pt_rules_admin_overview toplu sayıları. Her sayı alanın kanıt görünümüne
 * (`?gorunum=alan:<key>`: o alanın önerileri ve kanıtları) bağlanır — sıfır çıkmaz metrik.
 */
export function FieldConfidenceTable({
  portal,
  fields,
  overview,
  focusKey,
  focusLabel,
  hasSet,
}: {
  portal: TransferPortal;
  fields: SetField[];
  overview: Overview;
  focusKey: string | null;
  focusLabel: string | null;
  hasSet: boolean;
}) {
  return (
    <section aria-label="Alan güveni" className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <h2 className="font-display font-bold text-ink-950">{focusKey ? `Alan: ${focusLabel}` : "Alan güveni"}</h2>
      <p className="mt-1 text-sm text-text-muted">
        Güven, ofis oylarının Wilson alt sınırıdır (≥0,50 yüksek). Destek ve karşı sayıları ofis bazlıdır; ofis adı gösterilmez.
      </p>
      {!hasSet ? (
        <p className="mt-4 text-sm text-text-muted">
          Yayında kural seti yok; eklenti paket içindeki varsayılan kurallarla (tohum) çalışıyor. Sürüm geçmişinden tohumu yayınlayın.
        </p>
      ) : fields.length === 0 ? (
        <p className="mt-4 text-sm text-text-muted">Yayındaki sette bu alan yok.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs text-text-muted">
              <tr>
                <th className="py-2 pr-3 font-semibold">Alan</th>
                <th className="py-2 pr-3 font-semibold">Durum</th>
                <th className="py-2 pr-3 font-semibold">Güven</th>
                <th className="py-2 pr-3 font-semibold">Destek / karşı ofis</th>
                <th className="py-2 pr-3 font-semibold">14 günlük başarı</th>
                <th className="py-2 font-semibold">Son görülme</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {fields.map((f) => {
                const o = overview.fields.get(f.key);
                const state = fieldStateOf(f.state);
                const bucket = confidenceBucket(f.confidence);
                const href = portalRulesHref(portal, `alan:${f.key}`);
                return (
                  <tr key={f.key} className={focusKey === f.key ? "bg-surface-hover" : undefined}>
                    <td className="py-2 pr-3">
                      <Link href={href} className="font-semibold text-ink-950 hover:underline">
                        {fieldLabel(f.key)}
                      </Link>
                      {f.labels.length ? <p className="truncate text-xs text-text-faint">{f.labels.slice(0, 3).join(" · ")}</p> : null}
                    </td>
                    <td className="py-2 pr-3">
                      <Link href={href}>
                        <Badge variant={FIELD_STATE_TONES[state]} size="sm">
                          {FIELD_STATE_LABELS[state]}
                        </Badge>
                      </Link>
                    </td>
                    <td className="py-2 pr-3 tabular-nums">
                      <Link href={href} className="hover:underline">
                        {formatConfidence(f.confidence)}{" "}
                        <Badge variant={CONFIDENCE_TONES[bucket]} size="sm">
                          {CONFIDENCE_LABELS[bucket]}
                        </Badge>
                      </Link>
                    </td>
                    <td className="py-2 pr-3 tabular-nums">
                      <Link href={href} className="hover:underline">
                        {o ? `${o.supportTenants} / ${o.contradictTenants}` : "—"}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 tabular-nums">
                      <Link href={href} className="hover:underline">
                        {o ? formatPercent(o.success14d) : "—"}
                        {o && o.attempts14d > 0 ? <span className="text-xs text-text-faint"> · {o.attempts14d} deneme</span> : null}
                      </Link>
                    </td>
                    <td className="py-2 text-text-muted">{o?.lastSeen ? relativeTimeTR(o.lastSeen) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
