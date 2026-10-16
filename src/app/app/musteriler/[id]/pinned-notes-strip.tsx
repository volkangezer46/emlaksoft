import Link from "@/components/ui/smart-link";
import { Pin } from "lucide-react";
import { MAX_PINNED_NOTES, type CustomerNote } from "@/lib/customer-notes";
import { formatDateTr } from "@/lib/format";

/**
 * Künyenin altındaki "Sabit notlar" şeridi (CRM-G9): her sekmede görünür, en çok 3 not. Kritik bilgi ("kredi onayı
 * çıktı", "eşi evi görmeden karar vermez") uzun zaman çizelgesinde kaybolmaz. Her kart Notlar bölümüne götürür.
 */
export function PinnedNotesStrip({ customerId, notes }: { customerId: string; notes: CustomerNote[] }) {
  const pinned = notes.filter((n) => n.pinned_at).slice(0, MAX_PINNED_NOTES);
  if (pinned.length === 0) return null;
  const href = `/app/musteriler/${customerId}?sekme=ozet&notlar=sabit#notlar`;
  return (
    <section aria-label="Sabit notlar" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {pinned.map((n) => (
        <Link
          key={n.id}
          href={href}
          className="focus-ring group flex min-w-0 gap-2.5 rounded-[var(--radius-card)] border border-amber-400/40 bg-amber-400/[0.07] px-3 py-2.5 transition hover:border-amber-400/70"
        >
          <Pin className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
          <span className="min-w-0">
            <span className="line-clamp-2 whitespace-pre-line break-words text-sm font-medium text-ink-950">{n.body}</span>
            <span className="mt-0.5 block truncate text-xs text-text-faint">
              {n.author_name ?? "Ekip"} · {formatDateTr(n.created_at, { day: "numeric", month: "short" })}
            </span>
          </span>
        </Link>
      ))}
    </section>
  );
}
