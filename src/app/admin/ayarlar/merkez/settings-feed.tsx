import Link from "@/components/ui/smart-link";
import { FilterChip } from "@/components/ui/filter-chip";
import { relativeTimeTR } from "@/lib/admin-format";
import { createClient } from "@/lib/supabase/server";
import { getSettingDefByStorage } from "@/lib/settings/registry";
import { SYSTEM_KEY_PATTERNS } from "@/lib/settings/system-keys";

/**
 * Ayar merkezi "Son değişiklikler" akışı (settings_history, oturumlu istemci + RLS). "Yalnız insan değişiklikleri"
 * varsayılan AÇIK: SYSTEM_KEY_PATTERNS sunucu sorgusunda dışlanır (sayfa dolusu imleç kaydı listeyi boğmaz); gizlenen
 * sayı "N sistem kaydı gizlendi" olarak gösterilir. Gizli ayarlarda değer sütunu zaten null'dır (yalnız özet).
 */

type Row = { id: string; key: string; summary: string | null; reason: string | null; actor_type: string; is_secret: boolean; created_at: string };

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

// PostgREST sorgu kurucusunun zincir tipi geniş; yalnız `.neq/.not` kullanılır.
type Chain = { neq(col: string, v: string): Chain; not(col: string, op: string, v: string): Chain };
function excludeSystem<Q>(q: Q): Q {
  let c = q as unknown as Chain;
  for (const p of SYSTEM_KEY_PATTERNS) c = p.endsWith("*") ? c.not("key", "like", `${likeEscape(p.slice(0, -1))}%`) : c.neq("key", p);
  return c as unknown as Q;
}


export async function SettingsChangeFeed({ humanOnly, toggleHref }: { humanOnly: boolean; toggleHref: string }) {
  let rows: Row[] = [];
  let hidden = 0;
  try {
    const supabase = await createClient();
    const base = () => supabase.from("settings_history").select("id", { count: "exact", head: true }).eq("scope", "platform");
    let listQ = supabase
      .from("settings_history")
      .select("id, key, summary, reason, actor_type, is_secret, created_at")
      .eq("scope", "platform")
      .order("created_at", { ascending: false })
      .limit(20);
    if (humanOnly) listQ = excludeSystem(listQ);
    const [list, total, human] = await Promise.all([
      listQ,
      humanOnly ? base() : Promise.resolve({ count: 0 }),
      humanOnly ? excludeSystem(base()) : Promise.resolve({ count: 0 }),
    ]);
    rows = (list.data ?? []) as Row[];
    hidden = humanOnly ? Math.max(0, (total.count ?? 0) - (human.count ?? 0)) : 0;
  } catch {
    rows = [];
  }

  return (
    <section aria-labelledby="ayar-gecmis" className="space-y-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="ayar-gecmis" className="text-sm font-semibold text-ink-950">
          Son ayar değişiklikleri
        </h2>
        <FilterChip href={toggleHref} active={humanOnly}>
          Yalnız insan değişiklikleri
        </FilterChip>
      </div>
      {humanOnly && hidden > 0 ? (
        <p className="text-xs text-text-muted">
          {hidden.toLocaleString("tr-TR")} sistem kaydı gizlendi (imleç, SEO denetimi, yedek durumu gibi otomatik yazımlar).{" "}
          <Link href={toggleHref} className="font-semibold text-brand-600 hover:underline">
            Göster
          </Link>
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="text-xs text-text-muted">Kayıt yok.</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {rows.map((r) => {
            const def = getSettingDefByStorage("platform", r.key);
            return (
            <li key={r.id}>
              <Link
                href={`/admin/ayarlar/merkez?ara=${encodeURIComponent(def?.key ?? r.key)}`}
                className="flex flex-wrap items-center justify-between gap-2 py-2 hover:bg-surface-hover"
              >
                <span className="min-w-0">
                  <span className="block font-semibold text-ink-950">{def?.label ?? r.key}</span>
                  <span className="block text-xs text-text-muted">
                    {r.summary ?? (r.is_secret ? "gizli değer değişti" : "değer değişti")}
                    {r.reason ? ` · ${r.reason}` : ""}
                    {r.actor_type === "direct" ? " · doğrudan yazım" : ""}
                  </span>
                </span>
                <span className="text-xs text-text-faint">{relativeTimeTR(r.created_at)}</span>
              </Link>
            </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
