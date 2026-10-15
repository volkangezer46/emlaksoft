import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, parsePage } from "@/app/admin/_components/pagination";
import { loadEmailSuppressions } from "@/lib/email/log-read";
import { formatDateTimeTr } from "@/lib/format";
import type { EmailPageSearch } from "./page";
import { AddSuppressionForm, RemoveSuppressionButton } from "./suppression-tools";

const PAGE_SIZE = 50;
const REASON_LABEL = { bounce: "Bounce", complaint: "Şikâyet", manual: "Elle" } as const;

/**
 * Bastırma listesi: bounce/şikâyet webhook'la, elle ekleme süper adminle. Listede olan adrese gönderim İSTEK ATILMADAN
 * engellenir ve günlüğe "Bastırıldı" yazılır. Adres düz tutulmaz (maskeli gösterim + özet).
 */
export async function SuppressionView({ sp, canEdit }: { sp: EmailPageSearch; canEdit: boolean }) {
  const page = parsePage(sp.sayfa);
  const data = await loadEmailSuppressions(page, PAGE_SIZE);
  if (!data.installed) {
    return (
      <EmptyState
        title="Bastırma listesi kurulum bekliyor"
        description="E-posta günlüğü tabloları (migration 20261013004600) henüz uygulanmadı; şu an hiçbir adres bastırılmıyor."
      />
    );
  }
  return (
    <div className="space-y-4">
      {canEdit ? (
        <section aria-labelledby="bastir-ekle" className="space-y-2 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
          <h2 id="bastir-ekle" className="text-base font-semibold text-ink-950">
            Adres bastır
          </h2>
          <p className="text-xs text-text-muted">Bu adrese hiçbir işlemsel e-posta gitmez (giriş e-postaları Supabase Auth üzerinden gider, etkilenmez).</p>
          <AddSuppressionForm />
        </section>
      ) : null}
      {data.rows.length === 0 ? (
        <EmptyState title="Bastırılmış adres yok" description="Bounce ya da şikâyet gelen adresler buraya otomatik eklenir." />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface">
          <table className="adm-tbl-m w-full md:min-w-[620px] text-sm">
            <thead className="bg-canvas text-left text-xs text-text-muted">
              <tr>
                <th className="px-3 py-2 font-semibold">Adres</th>
                <th className="px-3 py-2 font-semibold">Neden</th>
                <th className="px-3 py-2 font-semibold">Eklenme</th>
                {canEdit ? <th className="px-3 py-2" /> : null}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className="border-t border-line align-top">
                  <td className="px-3 py-2 font-mono text-xs text-ink-950">{r.email_masked}</td>
                  <td data-label="Neden" className="px-3 py-2">
                    <Badge variant={r.reason === "manual" ? "neutral" : "danger"} size="sm">
                      {REASON_LABEL[r.reason] ?? r.reason}
                    </Badge>
                    {r.detail ? <p className="mt-1 max-w-[320px] text-xs text-text-muted">{r.detail}</p> : null}
                  </td>
                  <td data-label="Eklenme" className="whitespace-nowrap px-3 py-2 text-xs text-text-muted">{formatDateTimeTr(r.created_at)}</td>
                  {canEdit ? (
                    <td className="px-3 py-2 text-right">
                      <RemoveSuppressionButton id={r.id} />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination
        page={page}
        total={data.total}
        pageSize={PAGE_SIZE}
        hrefFor={(p) => `/admin/ayarlar/eposta?sekme=bastirma${p > 1 ? `&sayfa=${p}` : ""}`}
      />
    </div>
  );
}
