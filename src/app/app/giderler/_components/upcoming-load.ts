import "server-only";
import { createClient } from "@/lib/supabase/server";
import { shiftDayKey } from "@/lib/finance/smart-entry";
import type { UpcomingRow } from "./upcoming-list";

/**
 * Genel bakış "Önümüzdeki 7 gün" satırları: `finance_open_items_v`'den YALNIZ bugün..bugün+7 vadeli açık kalemler.
 * Vadesi geçenler bilinçli olarak dışarıda: onlar ayrı rozetle (sayı `finance_overview.overdue_count`) Cari'ye gider.
 * Alt sınır olmadan çekilseydi çok sayıda geçmiş kalem 50 satırlık sınırı doldurup yaklaşanları gizlerdi.
 * Kullanıcı oturumu + RLS (kiracı süzgeci); hata ya da şema yoksa boş liste (pano çökmez).
 */
const COLS = "key, source, direction, party_label, title, amount_open, currency, due_date, href";
const LIMIT = 50;

type Row = {
  key: string | null;
  source: string | null;
  direction: string | null;
  party_label: string | null;
  title: string | null;
  amount_open: number | string | null;
  currency: string | null;
  due_date: string | null;
  href: string | null;
};

export async function loadUpcomingWindow(today: string, days: number, fallbackHref: string): Promise<UpcomingRow[]> {
  const until = shiftDayKey(today, Math.min(366, Math.max(0, Math.round(days) || 0)));
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("finance_open_items_v")
    .select(COLS)
    .gt("amount_open", 0)
    .gte("due_date", today)
    .lte("due_date", until)
    .order("due_date", { ascending: true })
    .limit(LIMIT);
  if (error || !Array.isArray(data)) return [];
  return (data as Row[])
    .map((r) => {
      const amount = Number(r.amount_open);
      return {
        key: String(r.key ?? ""),
        source: String(r.source ?? ""),
        direction: r.direction === "payable" ? ("payable" as const) : ("receivable" as const),
        title: String(r.title ?? ""),
        partyLabel: r.party_label ? String(r.party_label) : null,
        amount: Number.isFinite(amount) ? amount : 0,
        currency: r.currency === "USD" || r.currency === "EUR" ? r.currency : "TRY",
        dueDate: r.due_date ? String(r.due_date).slice(0, 10) : null,
        href: r.href ? String(r.href) : fallbackHref,
      };
    })
    .filter((r) => r.key && r.amount > 0);
}
