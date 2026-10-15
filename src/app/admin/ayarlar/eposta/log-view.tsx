import Link from "@/components/ui/smart-link";
import { Button } from "@/components/ui/button";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, parsePage } from "@/app/admin/_components/pagination";
import { EMAIL_STATUSES, EMAIL_STATUS_LABEL, EMAIL_STATUS_TONE, emailTemplateLabel, isEmailStatus, loadEmailLog } from "@/lib/email/log-read";
import { EMAIL_TEMPLATES } from "@/lib/email/templates";
import type { EmailLogStatus } from "@/lib/email/webhook";
import { formatDateTimeTr } from "@/lib/format";
import type { EmailPageSearch } from "./page";

const PAGE_SIZE = 50;
const BASE = "/admin/ayarlar/eposta";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TONE_VARIANT: Record<string, BadgeVariant> = { success: "success", warn: "warning", danger: "danger", info: "info", neutral: "neutral" };

export function statusVariant(s: EmailLogStatus): BadgeVariant {
  return TONE_VARIANT[EMAIL_STATUS_TONE[s]] ?? "neutral";
}

/** Gönderim günlüğü: süzgeçler URL'de (durum · şablon · ofis · sayfa), sunucu süzgeci + gerçek sayfalama. */
export async function LogView({ sp }: { sp: EmailPageSearch }) {
  const status = isEmailStatus(sp.durum) ? sp.durum : undefined;
  const template = EMAIL_TEMPLATES.some((t) => t.key === sp.sablon) || sp.sablon === "test" ? sp.sablon : undefined;
  const tenantId = sp.ofis && UUID_RE.test(sp.ofis) ? sp.ofis : undefined;
  const page = parsePage(sp.sayfa);
  const data = await loadEmailLog({ status, template, tenantId, page, pageSize: PAGE_SIZE });

  const href = (over: Partial<Record<"durum" | "sablon" | "ofis" | "sayfa", string | undefined>>) => {
    const p = new URLSearchParams({ sekme: "gunluk" });
    const merged = { durum: status, sablon: template, ofis: tenantId, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `${BASE}?${p.toString()}`;
  };

  if (!data.installed) {
    return (
      <EmptyState
        title="Günlük kurulum bekliyor"
        description="E-posta günlüğü tabloları (migration 20261013004600) henüz uygulanmadı. Gönderimler sürer; kayıt tutulmaz."
      />
    );
  }

  return (
    <div className="space-y-4">
      <section aria-label="Durum sayıları" className="flex flex-wrap gap-2">
        {EMAIL_STATUSES.map((s) => (
          <Link
            key={s}
            href={href({ durum: status === s ? undefined : s, sayfa: undefined })}
            aria-current={status === s ? "true" : undefined}
            className={`focus-ring press inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition ${
              status === s ? "border-brand-500 bg-brand-500/10 text-brand-700" : "border-line bg-surface text-text-muted hover:border-brand-400"
            }`}
          >
            {EMAIL_STATUS_LABEL[s]} <span className="numeric text-ink-950">{data.statusCounts[s] ?? 0}</span>
          </Link>
        ))}
      </section>

      <form method="get" action={BASE} className="flex flex-wrap items-end gap-2 rounded-[var(--radius-card)] border border-line bg-surface p-3">
        <input type="hidden" name="sekme" value="gunluk" />
        {status ? <input type="hidden" name="durum" value={status} /> : null}
        {tenantId ? <input type="hidden" name="ofis" value={tenantId} /> : null}
        <label className="grid gap-1 text-xs font-semibold text-text-muted">
          Şablon
          <select name="sablon" defaultValue={template ?? ""} className="rounded-[var(--radius-control)] border border-line bg-canvas px-2 py-1.5 text-sm text-ink-950">
            <option value="">Tümü</option>
            <option value="test">Kanal testi</option>
            {EMAIL_TEMPLATES.filter((t) => !t.authType).map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="outline" size="sm">
          Uygula
        </Button>
        {tenantId ? (
          <Link href={href({ ofis: undefined, sayfa: undefined })} className="text-xs font-semibold text-brand-600 hover:underline">
            Ofis süzgecini kaldır ({data.tenantNames.get(tenantId) ?? "seçili ofis"}) ×
          </Link>
        ) : null}
        <p className="ml-auto text-xs text-text-muted">
          <span className="numeric font-semibold text-ink-950">{data.total}</span> kayıt
        </p>
      </form>

      {data.rows.length === 0 ? (
        <EmptyState
          title="Bu süzgeçte gönderim yok"
          description="Kanal açıkken gönderilen her e-posta (test dahil) burada görünür; teslim/bounce/açılma Resend webhook'u ile güncellenir."
        />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface">
          <table className="adm-tbl-m w-full md:min-w-[720px] text-sm">
            <thead className="bg-canvas text-left text-xs text-text-muted">
              <tr>
                <th className="px-3 py-2 font-semibold">Zaman</th>
                <th className="px-3 py-2 font-semibold">Alıcı</th>
                <th className="px-3 py-2 font-semibold">Şablon</th>
                <th className="px-3 py-2 font-semibold">Ofis</th>
                <th className="px-3 py-2 font-semibold">Durum</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className="border-t border-line align-top">
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-text-muted">{formatDateTimeTr(r.created_at)}</td>
                  <td data-label="Alıcı" className="px-3 py-2 font-mono text-xs text-ink-950">{r.to_masked}</td>
                  <td data-label="Şablon" className="px-3 py-2">
                    <Link href={href({ sablon: r.template, sayfa: undefined })} className="font-semibold text-ink-950 hover:text-brand-600">
                      {emailTemplateLabel(r.template)}
                    </Link>
                    <p className="max-w-[320px] truncate text-xs text-text-muted" title={r.subject}>
                      {r.subject || "—"} · {r.source}
                    </p>
                  </td>
                  <td data-label="Ofis" className="px-3 py-2 text-xs">
                    {r.tenant_id ? (
                      <Link href={`/admin/tenants/${r.tenant_id}?sekme=zaman&kategori=iletisim`} className="font-semibold text-brand-600 hover:underline">
                        {data.tenantNames.get(r.tenant_id) ?? "Ofis"}
                      </Link>
                    ) : (
                      <span className="text-text-faint">—</span>
                    )}
                  </td>
                  <td data-label="Durum" className="px-3 py-2">
                    <Link href={href({ durum: r.status, sayfa: undefined })}>
                      <Badge variant={statusVariant(r.status)} size="sm">
                        {EMAIL_STATUS_LABEL[r.status] ?? r.status}
                      </Badge>
                    </Link>
                    {r.error ? <p className="mt-1 max-w-[260px] text-xs text-text-muted">{r.error}</p> : null}
                    {r.delivered_at && r.status !== "delivered" ? (
                      <p className="mt-1 text-xs text-text-faint">Teslim: {formatDateTimeTr(r.delivered_at)}</p>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} total={data.total} pageSize={PAGE_SIZE} hrefFor={(p) => href({ sayfa: p > 1 ? String(p) : undefined })} />
    </div>
  );
}
