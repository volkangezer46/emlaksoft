import Link from "@/components/ui/smart-link";
import { AlertTriangle, Fingerprint, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { relativeTimeTR } from "@/lib/admin-format";
import type { TransferPortal } from "@/lib/portal-transfer/rules";
import { fieldLabel, formChangedText, formatPercent, portalRulesHref, shortFingerprint, type FormAlert } from "@/lib/portal-rules/admin-model";

export type CatalogField = {
  sig: string;
  control: string | null;
  /** Katlanmış etiket; yalnız ≥2 ofiste görülmüşse açık metin (SQL kapısı), aksi halde null. */
  label: string | null;
  optionsN: number;
  tenants: number;
  mappedKey: string | null;
  lastSeen: string | null;
};

/** Üst şerit: portal_form_versions uyarıları (warning/info). Her uyarı parmak izi kanıtına ve ilgili alan listesine gider. */
export function FormAlertsStrip({ portal, alerts, showEmpty }: { portal: TransferPortal; alerts: FormAlert[]; showEmpty?: boolean }) {
  if (alerts.length === 0) {
    return showEmpty ? (
      <p role="status" className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 text-sm text-text-muted">
        Form değişikliği uyarısı yok. Ofislerin gördüğü form yapısı bilinen sürümlerle uyumlu.
      </p>
    ) : null;
  }
  return (
    <section aria-label="Form değişikliği uyarıları" className="space-y-2">
      {alerts.map((a) => {
        const warn = a.alertState === "warning";
        const Icon = warn ? AlertTriangle : Info;
        return (
          <Link
            key={a.fingerprint}
            href={portalRulesHref(portal, `form:${a.fingerprint}`)}
            className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius-card)] border px-4 py-3 text-sm transition hover:bg-surface-hover touch:min-h-11 ${
              warn ? "border-amber-500/40 bg-amber-500/8" : "border-line bg-surface"
            }`}
          >
            <Icon className={`h-4 w-4 shrink-0 ${warn ? "text-amber-600" : "text-brand-600"}`} aria-hidden />
            <span className="min-w-0 flex-1 font-medium text-ink-950">{formChangedText(portal, a)}</span>
            <span className="inline-flex items-center gap-1 text-xs text-text-muted">
              <Fingerprint className="h-3.5 w-3.5" aria-hidden /> <span className="numeric">{shortFingerprint(a.fingerprint)}</span>
              {a.lastSeen ? ` · ${relativeTimeTR(a.lastSeen)}` : ""}
            </span>
          </Link>
        );
      })}
    </section>
  );
}

/** `?gorunum=form:<parmak izi>`: parmak izi kanıtı + o yapı görüldükten sonra kataloğa düşen alanlar (kiracı adı yok). */
export function FormEvidence({ portal, fingerprint, alert, fields }: { portal: TransferPortal; fingerprint: string; alert: FormAlert | null; fields: CatalogField[] }) {
  const unmatched = fields.filter((f) => !f.mappedKey);
  return (
    <section aria-label="Form parmak izi kanıtı" className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <p className="flex items-center gap-2 text-xs font-semibold text-text-muted">
        <Fingerprint className="h-4 w-4" /> Parmak izi <span className="numeric break-all">{fingerprint}</span>
      </p>
      {alert ? (
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
          <Fact label="Durum" value={alert.alertState === "warning" ? "Uyarı" : "Bilgi"} />
          <Fact label="Alan sayısı" value={String(alert.fieldCount)} />
          <Fact label="Gören ofis" value={String(alert.tenantsN)} />
          <Fact label="Önceki yapıyla benzerlik" value={formatPercent(alert.jaccardPrev)} />
          <Fact label="İlk görülme" value={alert.firstSeen ? relativeTimeTR(alert.firstSeen) : "—"} />
          <Fact label="Son görülme" value={alert.lastSeen ? relativeTimeTR(alert.lastSeen) : "—"} />
        </dl>
      ) : (
        <p className="mt-2 text-sm text-text-muted">Bu parmak izi için açık uyarı yok (çözülmüş ya da süresi dolmuş olabilir).</p>
      )}
      <h3 className="mt-5 text-sm font-semibold text-ink-950">
        Bu yapıdan sonra görülen alanlar ({fields.length}; {unmatched.length} eşleşmemiş)
      </h3>
      {fields.length === 0 ? (
        <p className="mt-2 text-sm text-text-muted">Katalogda bu dönemde görülen alan yok.</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="adm-tbl-m w-full md:min-w-[560px] text-left text-sm">
            <thead className="text-xs text-text-muted">
              <tr>
                <th className="py-2 pr-3 font-semibold">Etiket</th>
                <th className="py-2 pr-3 font-semibold">Tür</th>
                <th className="py-2 pr-3 font-semibold">Seçenek</th>
                <th className="py-2 pr-3 font-semibold">Ofis</th>
                <th className="py-2 pr-3 font-semibold">Eşleşen alan</th>
                <th className="py-2 font-semibold">Son görülme</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {fields.map((f) => (
                <tr key={f.sig}>
                  <td className="py-2 pr-3 text-ink-950">{f.label ?? <span className="text-text-faint">tek ofis (gizli)</span>}</td>
                  <td data-label="Tür" className="py-2 pr-3 text-text-muted">{f.control ?? "—"}</td>
                  <td data-label="Seçenek" className="py-2 pr-3 tabular-nums">{f.optionsN}</td>
                  <td data-label="Ofis" className="py-2 pr-3 tabular-nums">{f.tenants}</td>
                  <td data-label="Eşleşen alan" className="py-2 pr-3">
                    {f.mappedKey ? (
                      <Link href={portalRulesHref(portal, `alan:${f.mappedKey}`)} className="font-semibold text-brand-600 hover:underline">
                        {fieldLabel(f.mappedKey)}
                      </Link>
                    ) : (
                      <Badge variant="warning" size="sm">
                        Eşleşmemiş
                      </Badge>
                    )}
                  </td>
                  <td data-label="Son görülme" className="py-2 text-text-muted">{f.lastSeen ? relativeTimeTR(f.lastSeen) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="m-0 font-semibold tabular-nums text-ink-950">{value}</dd>
    </div>
  );
}
