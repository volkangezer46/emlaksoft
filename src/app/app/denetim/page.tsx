import {
  Activity,
  Fingerprint,
  ScrollText,
  Shield,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { exportAuditCsv } from "@/app/actions/export";
import { ExportCsvButton } from "@/components/app/export-csv-button";
import { DAY_MS, msSince, now } from "@/lib/clock";
import { ListLimitNotice } from "@/components/app/list-limit-notice";

const actionLabel: Record<string, string> = {
  "workflow.deal_won": "Satış kapandı",
  "commission.paid": "Komisyon tahsil",
  "commission.from_pipeline": "Satış hattı komisyonu",
  "deal.create": "Anlaşma oluşturuldu",
  "deal.stage": "Anlaşma aşaması",
  "payment_link.create": "Ödeme linki",
  "share.create": "Paylaşım linki",
  "ops.impersonate.start": "Ofis önizleme başladı",
  "ops.impersonate.stop": "Ofis önizleme bitti",
  "customer.create": "Müşteri eklendi",
  "customer.update": "Müşteri güncellendi",
  "match.save": "Eşleştirme kaydı",
};

function diffPreview(oldValue: unknown, newValue: unknown) {
  if (oldValue && newValue && typeof oldValue === "object" && typeof newValue === "object") {
    const o = oldValue as Record<string, unknown>;
    const n = newValue as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(o), ...Object.keys(n)])].slice(0, 4);
    const parts = keys
      .filter((k) => JSON.stringify(o[k]) !== JSON.stringify(n[k]))
      .map((k) => `${k}: ${JSON.stringify(o[k]) ?? "∅"} → ${JSON.stringify(n[k]) ?? "∅"}`);
    if (parts.length) return parts.join(" · ");
  }
  if (newValue) return JSON.stringify(newValue).slice(0, 96);
  if (oldValue) return JSON.stringify(oldValue).slice(0, 96);
  return "—";
}

export default async function AuditPage() {
  await requireModulePage("settings");
  const supabase = await createClient();
  const { data: logs, count: logTotal } = await supabase
    .from("audit_logs")
    // Denetim kaydında sessiz kırpma özellikle sakıncalı: "kayıt yok"
    // ile "kayıt var ama listede değil" arasındaki fark, denetimin
    // anlamını belirliyor.
    .select(
      "id, action, entity_type, entity_id, actor_id, new_value, old_value, created_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .limit(120);

  const rows = logs ?? [];
  const actorIds = [...new Set(rows.map((r) => r.actor_id).filter(Boolean))] as string[];
  const actorNames = new Map<string, string>();
  if (actorIds.length) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", actorIds);
    for (const p of profiles ?? []) actorNames.set(p.id, p.full_name);
  }

  const today = rows.filter((r) => msSince(r.created_at) < DAY_MS).length;

  const buckets = Array.from({ length: 12 }, () => 0);
  const nowMs = now();
  rows.forEach((r) => {
    const hours = Math.floor((nowMs - new Date(r.created_at).getTime()) / (2 * 3600_000));
    if (hours >= 0 && hours < 12) buckets[11 - hours] += 1;
  });
  const maxB = Math.max(1, ...buckets);

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -left-10 bottom-0 h-48 w-48 rounded-full bg-danger-500/20 blur-[80px]" />
        <div className="relative grid gap-6 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <div>
            <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-danger-300">
              <Shield className="h-3.5 w-3.5" /> KVKK / denetim izi
            </p>
            <h1 className="mt-2 font-display text-3xl font-extrabold">Denetim kayıtları</h1>
            <p className="mt-2 max-w-lg text-sm text-white/60">
              Yazma işlemlerinin immutable günlüğü. Sahte aktivite yok — yalnızca `logActivity` kayıtları.
            </p>
            <div className="mt-5 grid grid-cols-3 gap-3">
              {[
                { label: "Son 120", value: rows.length, icon: ScrollText },
                { label: "Son 24s", value: today, icon: Activity },
                { label: "Aktör", value: actorIds.length, icon: Fingerprint },
              ].map((k) => (
                <div key={k.label} className="rounded-[14px] border border-white/10 bg-white/5 p-3">
                  <k.icon className="h-4 w-4 text-amber-300" />
                  <p className="mt-1 font-display text-xl font-extrabold">{k.value}</p>
                  <p className="text-[10px] text-white/45">{k.label}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-[16px] border border-white/10 bg-white/[0.04] p-4">
            <p className="text-xs font-semibold text-white/70">Aktivite · son 24 saat (2s dilim)</p>
            <div className="mt-4 flex h-28 items-end gap-1.5">
              {buckets.map((b, i) => (
                <div
                  key={i}
                  className="bar-live flex-1 rounded-t-[4px] bg-gradient-to-t from-amber-500/80 to-amber-300"
                  style={{ height: `${Math.max(8, (b / maxB) * 100)}%`, animationDelay: `${i * 40}ms` }}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-[20px] border border-line bg-surface shadow-[var(--shadow-xs)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="font-display font-bold text-ink-950">Olay akışı</h2>
            <p className="text-xs text-text-muted">Aktör + değişiklik · ofis izole</p>
          </div>
          <ExportCsvButton label="CSV dışa aktar" action={exportAuditCsv} />
        </div>
        {rows.length === 0 ? (
          <div className="grid place-items-center px-6 py-16 text-center">
            <ScrollText className="h-8 w-8 text-text-faint" />
            <p className="mt-3 text-sm text-text-muted">Henüz denetim kaydı yok. İlk yazma işlemi burada görünecek.</p>
          </div>
        ) : (
          <div className="divide-y divide-line">
            <div className="px-5 py-3">
              <ListLimitNotice
                shown={rows.length}
                total={logTotal}
                hint="Daha eski kayıtlar için dışa aktarım kullanın."
              />
            </div>
            {rows.map((r) => (
              <article key={r.id} className="grid gap-2 px-5 py-3.5 transition hover:bg-brand-600/[0.02] md:grid-cols-[1.1fr_1.2fr_.7fr_auto] md:items-center">
                <div>
                  <p className="text-sm font-semibold text-ink-950">
                    {actionLabel[r.action] ?? r.action}
                  </p>
                  <p className="mt-0.5 text-[11px] text-text-muted">
                    {r.entity_type ?? "—"}
                    {r.entity_id ? ` · ${String(r.entity_id).slice(0, 8)}…` : ""}
                  </p>
                </div>
                <p className="truncate text-[11px] text-text-muted" title={diffPreview(r.old_value, r.new_value)}>
                  {diffPreview(r.old_value, r.new_value)}
                </p>
                <p className="text-xs font-semibold text-ink-950">
                  {r.actor_id ? (actorNames.get(r.actor_id) ?? r.actor_id.slice(0, 8)) : "Sistem"}
                </p>
                <time className="text-xs font-semibold text-text-muted tabular-nums">
                  {new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short" }).format(new Date(r.created_at))}
                </time>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
