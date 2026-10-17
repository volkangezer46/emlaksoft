import Link from "@/components/ui/smart-link";
import { History } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { createClient } from "@/lib/supabase/server";
import { getSettingDef, getSettingDefByStorage } from "@/lib/settings/registry";
import { ZEKA_SURFACE_SHORT } from "@/lib/ai/zeka/center";

export const fieldClass = "w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2.5 text-sm text-ink-950";
export const labelClass = "grid gap-1 text-sm";
export const MISSING = new Set(["42P01", "PGRST205", "PGRST202", "42883"]);
export const DATE = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
export const surfaceLabel = (s: string) => (s === "all" ? "Tüm yüzeyler" : ((ZEKA_SURFACE_SHORT as Record<string, string>)[s] ?? s));
export const fmtInt = (n: number) => n.toLocaleString("tr-TR");

type HistoryRow = { id: string; key: string; version: number; summary: string | null; reason: string | null; created_at: string; new_value: unknown };

/**
 * Sekmenin ayar geçmişi (settings_history; RLS: platform personeli). Geri alma Ayar merkezindedir (sürüm geçmişi).
 * Gizli değer burada yoktur (Zeka ayarlarının hiçbiri gizli değildir; anahtar ayrı gizli ayardır).
 */
export async function SettingsHistoryCard({ keys, title = "Son değişiklikler" }: { keys: readonly string[]; title?: string }) {
  let rows: HistoryRow[] = [];
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("settings_history")
      .select("id, key, version, summary, reason, created_at, new_value")
      .eq("scope", "platform")
      .is("tenant_id", null)
      .in("key", [...keys])
      .order("created_at", { ascending: false })
      .limit(10);
    rows = error ? [] : ((data ?? []) as HistoryRow[]);
  } catch {
    rows = [];
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>Her kayıt sürümlenir ve denetim izine yazılır. Önceki sürüme dönmek için ayarın Ayar merkezindeki geçmişini açın.</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState variant="compact" bare icon={History} title="Henüz değişiklik yok" description="Bu sekmedeki ayarlar varsayılan değerlerinde." />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => {
              const def = getSettingDef(r.key) ?? getSettingDefByStorage("platform", r.key);
              const value = typeof r.new_value === "string" ? r.new_value : r.new_value == null ? "varsayılan" : JSON.stringify(r.new_value);
              return (
                <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 text-sm">
                  <Link href={`/admin/ayarlar?ara=${encodeURIComponent(def?.label ?? r.key)}#${encodeURIComponent(r.key)}`} className="min-w-0 font-semibold text-ink-950 hover:underline">
                    {def?.label ?? r.key}
                  </Link>
                  <span className="text-xs text-text-faint">
                    v{r.version} · {DATE.format(new Date(r.created_at))}
                  </span>
                  <span className="w-full min-w-0 truncate text-xs text-text-muted">{r.summary ?? (value.length > 120 ? `${value.slice(0, 120)}…` : value)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
