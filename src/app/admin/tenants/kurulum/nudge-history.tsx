import Link from "@/components/ui/smart-link";
import { BellRing, Mail, Settings2 } from "lucide-react";
import { FilterChip } from "@/components/ui/filter-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTimeTr } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSetting } from "@/lib/settings/read";
import { CRM_SETTING_KEYS } from "@/lib/settings/registry/crm";
import { NUDGE_KEYS, NUDGE_KEY_LABELS, NUDGE_KIND_LABELS, type NudgeKey, type NudgeKind } from "@/lib/admin/lifecycle-nudges";

/**
 * Ofisler > Kurulum > Hatırlatmalar (PA-12): aktivasyon dürtmelerinin gönderim geçmişi (son 200). Anahtar süzgeci
 * (`anahtar=`), her satır ofisin 360 ekranına; metinler E-posta şablonlarından, aç/kapa ayar merkezinden yönetilir.
 * Kapı ÇAĞIRANDA (`requirePlatformModule("sales")`).
 */

const BASE = "/admin/tenants/kurulum?sekme=hatirlatma";
const TEMPLATE_OF: Record<string, string> = {
  first_property: "nudge_first_property",
  team_invite: "nudge_team_invite",
  next_step: "nudge_next_step",
  trial_recap: "trial_value_recap",
  win_back: "trial_win_back",
};

type Row = {
  id: string;
  tenant_id: string;
  nudge_key: string;
  kind: string;
  step_id: string | null;
  in_app_count: number;
  email_sent: number;
  email_skipped: number;
  created_at: string;
  tenant: { name: string } | { name: string }[] | null;
};

export async function NudgeHistory({ anahtar }: { anahtar: string | null }) {
  const key = (NUDGE_KEYS as readonly string[]).includes(anahtar ?? "") ? (anahtar as NudgeKey) : null;
  const admin = createAdminClient();
  let q = admin
    .from("tenant_lifecycle_nudges")
    .select("id, tenant_id, nudge_key, kind, step_id, in_app_count, email_sent, email_skipped, created_at, tenant:tenants!tenant_lifecycle_nudges_tenant_id_fkey(name)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (key) q = q.eq("nudge_key", key);
  const [{ data, error }, enabled] = await Promise.all([q, getSetting<boolean>(CRM_SETTING_KEYS.nudgesEnabled).catch(() => true)]);
  const rows = (data ?? []) as unknown as Row[];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" aria-hidden="true" />
          <div className="text-sm">
            <p className="font-semibold text-ink-950">
              Aktivasyon hatırlatmaları {enabled === false ? <span className="adm-badge pm-t-neutral ml-1">Kapalı</span> : <span className="adm-badge pm-t-success ml-1">Açık</span>}
            </p>
            <p className="mt-0.5 text-text-muted">
              Yeni ofis sahiplerine 1., 3. ve 7. günde eksik kurulum adımı, deneme bitmeden değer özeti ve bitişten 7 gün sonra geri kazanım; uygulama içi ve e-posta. Ofis başına haftada en çok 2; sahip &quot;Önemli öneriler&quot; bildirimini kapattıysa gönderilmez.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/ayarlar/eposta#nudge_first_property" className="focus-ring inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-line px-3 text-xs font-semibold text-ink-950 hover:bg-surface-hover touch:min-h-11">
            <Mail className="h-3.5 w-3.5" aria-hidden="true" /> Metinleri düzenle
          </Link>
          <Link href="/admin/ayarlar?kategori=saglik" className="focus-ring inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-line px-3 text-xs font-semibold text-ink-950 hover:bg-surface-hover touch:min-h-11">
            <Settings2 className="h-3.5 w-3.5" aria-hidden="true" /> Aç / kapat
          </Link>
        </div>
      </div>

      <nav aria-label="Hatırlatma türü süzgeci" className="flex flex-wrap gap-2">
        <FilterChip href={BASE} active={!key}>
          Tümü
        </FilterChip>
        {NUDGE_KEYS.map((k) => (
          <FilterChip key={k} href={`${BASE}&anahtar=${k}`} active={key === k}>
            {NUDGE_KEY_LABELS[k]}
          </FilterChip>
        ))}
      </nav>

      {error ? (
        <p className="rounded-[var(--radius-panel)] border border-amber-400/30 bg-amber-400/8 px-5 py-6 text-sm text-amber-700">
          Kurulum bekliyor: hatırlatma defteri veritabanı güncellemesiyle (20261019060000) gelir. O zamana kadar hatırlatma gönderilmez.
        </p>
      ) : rows.length === 0 ? (
        <EmptyState icon={BellRing} title="Henüz hatırlatma gönderilmedi" description="Günlük abonelik turunda uygun ofis bulunduğunda gönderimler burada listelenir." />
      ) : (
        <ul className="divide-y divide-[var(--hairline)] overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface" aria-label="Gönderim geçmişi">
          {rows.map((r) => {
            const tenant = Array.isArray(r.tenant) ? r.tenant[0] : r.tenant;
            const kindLabel = NUDGE_KIND_LABELS[r.kind as NudgeKind] ?? r.kind;
            return (
              <li key={r.id} className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                <div className="min-w-0 flex-1">
                  <Link href={`/admin/tenants/${r.tenant_id}`} className="focus-ring font-semibold text-ink-950 hover:underline [overflow-wrap:anywhere]">
                    {tenant?.name ?? "Ofis"}
                  </Link>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
                    <span className="adm-badge pm-t-brand">{NUDGE_KEY_LABELS[r.nudge_key as NudgeKey] ?? r.nudge_key}</span>
                    <Link href={`/admin/ayarlar/eposta#${TEMPLATE_OF[r.kind] ?? "nudge_next_step"}`} className="focus-ring hover:underline">
                      {kindLabel}
                      {r.step_id && r.kind === "next_step" ? ` · ${r.step_id}` : ""}
                    </Link>
                  </p>
                </div>
                <p className="flex flex-wrap gap-x-3 text-xs text-text-muted sm:justify-end">
                  <span>{r.in_app_count} bildirim</span>
                  <span>{r.email_sent} e-posta{r.email_skipped ? ` · ${r.email_skipped} gönderilmedi` : ""}</span>
                  <span className="tabular-nums">{formatDateTimeTr(r.created_at)}</span>
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
