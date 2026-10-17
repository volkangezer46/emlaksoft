import { KeyRound } from "lucide-react";
import Link from "@/components/ui/smart-link";
import { StatusPill } from "@/components/ui/list-kit/status-pill";
import { SECRET_GROUP_LABELS, SECRET_ROTATION_WARN_DAYS, type SecretGroup, type SecretRotationRow } from "@/lib/admin/ops/secret-rotation";
import { loadSecretRotation } from "@/lib/admin/ops/secret-rotation-read";

const DATE = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "medium" });
const GROUP_ORDER: readonly SecretGroup[] = ["entegrasyon", "yapay_zeka", "portal", "imza"];

function AgePill({ r }: { r: SecretRotationRow }) {
  if (!r.set) return <StatusPill tone="neutral">Tanımsız</StatusPill>;
  if (r.ageDays === null) return <StatusPill tone="neutral">Tarih izlenmiyor</StatusPill>;
  if (r.warn) return <StatusPill tone="warning">{`${r.ageDays} gün: döndürün`}</StatusPill>;
  return <StatusPill tone="success">{r.ageDays === 0 ? "Bugün" : `${r.ageDays} gün`}</StatusPill>;
}

/**
 * Sistem > Entegrasyonlar > "Anahtar yaşı": her yapılandırılmış sır için yalnız ad, tanımlı mı ve son döndürme tarihi
 * (meta veri; DEĞER OKUNMAZ, parmak izi bile gösterilmez). 180 günü geçen anahtar uyarı alır. Panel anahtarlarının
 * tarihi ayar geçmişinden; sunucu ortamı anahtarlarınınki isteğe bağlı `<AD>_ROTATED_AT` eş değişkeninden gelir.
 */
export async function SecretRotationPanel() {
  const rows = await loadSecretRotation();
  const set = rows.filter((r) => r.set);
  const warn = set.filter((r) => r.warn).length;
  const untracked = set.filter((r) => r.ageDays === null).length;

  return (
    <section id="anahtar-yasi" className="scroll-mt-24 overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface" aria-labelledby="anahtar-yasi-baslik">
      <div className="border-b border-line px-5 py-3.5">
        <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
          <KeyRound className="h-4 w-4" aria-hidden /> Sır rotasyonu
        </p>
        <h2 id="anahtar-yasi-baslik" className="mt-1 font-display font-bold text-ink-950">
          Anahtar yaşı
        </h2>
        <p className="mt-1 text-xs text-text-muted">
          {set.length} tanımlı anahtar · {warn > 0 ? <span className="font-semibold text-amber-800">{warn} anahtar {SECRET_ROTATION_WARN_DAYS} günden eski</span> : `${SECRET_ROTATION_WARN_DAYS} günden eski anahtar yok`}
          {untracked > 0 ? ` · ${untracked} anahtarın tarihi izlenmiyor` : ""}. Değerler okunmaz ve gösterilmez.
        </p>
      </div>
      <div className="grid gap-4 p-5 lg:grid-cols-2">
        {GROUP_ORDER.map((g) => {
          const list = rows.filter((r) => r.group === g);
          if (list.length === 0) return null;
          return (
            <div key={g} className="min-w-0">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-faint">{SECRET_GROUP_LABELS[g]}</h3>
              <ul className="mt-2 divide-y divide-line" aria-label={SECRET_GROUP_LABELS[g]}>
                {list.map((r) => (
                  <li key={r.id} className="grid grid-cols-[minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="min-w-0">
                      {r.href ? (
                        <Link href={r.href} className="focus-ring block truncate rounded-sm text-sm font-semibold text-[var(--heading)] hover:underline" title={r.label}>
                          {r.label}
                        </Link>
                      ) : (
                        <span className="block truncate text-sm font-semibold text-[var(--heading)]" title={r.label}>
                          {r.label}
                        </span>
                      )}
                      <span className="line-clamp-2 block break-words text-xs text-text-muted">
                        {r.source === "panel" ? "Panelden girilir" : "Sunucu ortamı"}
                        {r.set && r.rotatedAt ? ` · son döndürme ${DATE.format(new Date(r.rotatedAt))}` : ""}
                        {r.set && !r.rotatedAt && r.trackVar ? ` · tarih için ${r.trackVar}=YYYY-AA-GG ekleyin` : ""}
                      </span>
                    </div>
                    <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
                      <AgePill r={r} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
