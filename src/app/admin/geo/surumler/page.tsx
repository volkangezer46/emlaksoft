import { History } from "lucide-react";
import { requirePlatformModule } from "@/lib/platform";
import { listVersions } from "@/lib/geo/admin-store";
import { formatDateTimeTr } from "@/lib/format";
import { RollbackButton } from "./rollback-button";

const KIND: Record<string, string> = { import: "İçe aktarma", manual: "Elle", merge: "Birleştirme", move: "Taşıma", rollback: "Geri alma" };
const STATUS: Record<string, string> = { applied: "Uygulandı", rolled_back: "Geri alındı", failed: "Yarım kaldı (geri alınabilir)" };

function summaryText(summary: Record<string, unknown>): string {
  const sum = (o: unknown) => {
    const r = o as Record<string, number> | undefined;
    return r ? (r.province ?? 0) + (r.district ?? 0) + (r.neighborhood ?? 0) : 0;
  };
  if ("add" in summary) {
    return `+${sum(summary.add)} eklendi · ${sum(summary.change)} değişti · ${sum(summary.deactivate)} pasife alındı`;
  }
  if ("moved_rows" in summary) return `${summary.from_name ?? "?"} → ${summary.to_name ?? "?"} · ${summary.moved_rows} kayıt taşındı`;
  return "";
}

export default async function AdminGeoVersionsPage() {
  const staff = await requirePlatformModule("geo");
  const canWrite = staff.role === "super_admin";
  const versions = await listVersions(100);

  return (
    <div className="space-y-5">
      <header>
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-amber-600"><History className="h-3.5 w-3.5" /> Sürüm geçmişi</p>
        <h1 className="mt-1 font-display text-2xl font-extrabold">Coğrafya sürümleri</h1>
        <p className="mt-1 max-w-2xl text-sm text-text-muted">Kim, ne zaman, hangi kaynak, fark özeti. Geri alma yalnız o işlemin yaptığı değişiklikleri geri alır ve referans kırmaz.</p>
      </header>

      {versions === null ? (
        <p className="rounded-[var(--radius-card)] border border-amber-300/50 bg-amber-500/[0.06] px-4 py-3 text-sm text-amber-800">
          Sürüm kaydı bu ortamda henüz etkin değil (geo yönetim migration&apos;ı uygulanmamış). Uygulanana dek içe aktarma ve birleştirme kapalıdır.
        </p>
      ) : versions.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-10 text-center text-sm text-text-muted">Henüz sürüm kaydı yok. İlk içe aktarma ya da birleştirmeden sonra burada görünür.</p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
          {versions.map((v) => (
            <li key={v.id} className="space-y-1.5 px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-canvas px-2 py-0.5 text-xs font-bold text-text-muted">{KIND[v.kind] ?? v.kind}</span>
                <span className="font-semibold">{formatDateTimeTr(v.createdAt)}</span>
                <span className="text-xs text-text-muted">{v.actorLabel ?? "—"}</span>
                <span className={`ml-auto text-xs font-bold ${v.status === "applied" ? "text-success-600" : v.status === "failed" ? "text-danger-500" : "text-text-muted"}`}>{STATUS[v.status] ?? v.status}</span>
              </div>
              <p className="text-sm text-text-muted">
                Kaynak: {v.source ?? "manuel"}{v.sourceVersion ? ` · sürüm ${v.sourceVersion}` : ""}{v.sourceDate ? ` · ${v.sourceDate}` : ""}{v.fileName ? ` · ${v.fileName}` : ""}{v.mode ? ` · kip: ${v.mode === "full" ? "tam kaynak" : "birleştir"}` : ""}
              </p>
              <p className="text-sm">{summaryText(v.summary)}</p>
              {canWrite && v.status !== "rolled_back" && (v.kind === "import" || v.kind === "merge") ? (
                <RollbackButton versionId={v.id} label={`${KIND[v.kind]} · ${formatDateTimeTr(v.createdAt)}`} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
