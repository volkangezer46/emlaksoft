import { Flag } from "lucide-react";
import Link from "@/components/ui/smart-link";
import { StatusPill } from "@/components/ui/list-kit/status-pill";
import { getFeatureFlagStates } from "@/lib/feature-flags/server";
import { explainFlagForOffice } from "@/lib/admin/ops/office-flags";
import { now } from "@/lib/clock";
import { OfficeFlagToggle } from "./office-flag-toggle";

/**
 * Ofis 360 > Yönetim > "Özellik bayrakları": her bayrağın BU ofiste açık mı olduğu ve nedeni (genel anahtar, bağlı
 * bayrak, hedefleme kuralı: ofis listesi / plan / yüzde / zaman penceresi). Hedeflenebilir ve kuralı olan bayrakta
 * süper admin ofisi seçili listeye ekleyip çıkarabilir (gerekçe + doğrulayıcı kodu, `setOfficeFlagMembership`).
 * Genel anahtar ve kural kurulumu Ayarlar > Özellik bayrakları'dadır.
 */
export async function OfficeFlagsPanel({ tenantId, plan, canEdit }: { tenantId: string; plan: string | null; canEdit: boolean }) {
  const states = await getFeatureFlagStates();
  const nowMs = now();
  const rows = states.map((s) => ({
    s,
    e: explainFlagForOffice({
      globalOn: s.enabled,
      blockedByRequires: s.raw && !s.enabled,
      targetable: Boolean(s.def.targetable),
      rule: s.rule,
      target: { tenantId, plan },
      nowMs,
    }),
  }));
  const on = rows.filter((r) => r.e.on).length;
  return (
    <section className="dashboard-panel rounded-[var(--radius-panel)] border border-line bg-surface p-5" aria-labelledby="ofis-bayrak-baslik">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="ofis-bayrak-baslik" className="flex items-center gap-2 font-display font-bold text-ink-950">
            <Flag className="h-4 w-4 text-brand-600" aria-hidden /> Özellik bayrakları
          </h2>
          <p className="mt-0.5 text-xs text-text-muted">
            Bu ofiste {on} / {rows.length} bayrak açık. Genel anahtar ve hedefleme kuralı Ayarlar &gt; Özellik bayrakları ekranındadır.
          </p>
        </div>
        <Link href="/admin/ayarlar/bayraklar" className="focus-ring shrink-0 text-xs font-semibold text-brand-600 hover:underline">
          Bayrak ekranı
        </Link>
      </div>
      <ul className="mt-3 divide-y divide-line" aria-label="Bu ofisteki bayraklar">
        {rows.map(({ s, e }) => (
          <li key={s.def.key} className="grid grid-cols-[minmax(0,1fr)] gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink-950" title={s.def.label}>
                {s.def.label}
              </p>
              <p className="line-clamp-2 text-xs text-text-muted" title={e.text}>
                {e.text}
              </p>
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
              <StatusPill tone={e.on ? "success" : "neutral"}>{e.on ? "Açık" : "Kapalı"}</StatusPill>
              {canEdit && s.def.targetable && s.rule && s.enabled ? <OfficeFlagToggle flagKey={s.def.key} label={s.def.label} tenantId={tenantId} inList={e.inList} /> : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
