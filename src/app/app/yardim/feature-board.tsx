import { FilterChip } from "@/components/ui/filter-chip";
import { ThumbsUp } from "lucide-react";
import { REQUEST_STATUS_LABEL, type RequestStatus } from "@/lib/product-feedback/model";
import { loadBoard, type BoardItem } from "@/lib/product-feedback/store";
import { FeatureRequestForm, VoteButton } from "./feature-board-controls";

const PANEL = "rounded-[var(--radius-panel)] border border-line bg-surface p-5";
const fmt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeZone: "Europe/Istanbul" });

/** Süzgeçler (URL `durum`): ofisin gördüğü öneriler durumuna göre; "benim" = ofisin kendi önerileri. */
export const BOARD_FILTERS = [
  { id: "tumu", label: "Tümü" },
  { id: "degerlendiriliyor", label: "Oylamada" },
  { id: "planlandi", label: "Planlandı" },
  { id: "yapiliyor", label: "Yapılıyor" },
  { id: "yayinda", label: "Yayında" },
  { id: "benim", label: "Ofisimin önerileri" },
] as const;
type BoardFilter = (typeof BOARD_FILTERS)[number]["id"];

const TONE: Record<RequestStatus, string> = {
  yeni: "bg-ink-950/6 text-text-muted",
  degerlendiriliyor: "bg-brand-600/12 text-brand-600",
  planlandi: "bg-amber-400/15 text-amber-700",
  yapiliyor: "bg-cyan-500/15 text-cyan-700",
  yayinda: "bg-mint-500/15 text-mint-700",
  reddedildi: "bg-ink-950/6 text-text-muted",
};

function matches(item: BoardItem, f: BoardFilter): boolean {
  if (f === "tumu") return true;
  if (f === "benim") return item.mine;
  return item.status === f;
}

/**
 * Yardım > Öneri panosu (DG8): ofisler özellik önerir ve oy verir (OFİS BAŞINA TEK OY). EmlakSoft önerinin durumunu
 * günceller (Planlandı / Yapılıyor / Yayında). Yeni öneri incelenene kadar yalnız öneren ofise görünür.
 */
export async function FeatureBoardTab({ tenantId, filter, canWrite }: { tenantId: string; filter: string | undefined; canWrite: boolean }) {
  const board = await loadBoard(tenantId).catch(() => null);
  if (!board || !board.ready) {
    return (
      <div className={PANEL}>
        <p className="text-sm text-text-muted">Öneri panosu şu an hazırlanıyor. Bir önerinizi Destek sekmesinden de iletebilirsiniz.</p>
      </div>
    );
  }
  const active: BoardFilter = (BOARD_FILTERS.find((f) => f.id === filter)?.id ?? "tumu") as BoardFilter;
  const items = board.items.filter((i) => matches(i, active));
  const hrefFor = (f: BoardFilter) => (f === "tumu" ? "/app/yardim?sekme=oneriler" : `/app/yardim?sekme=oneriler&durum=${f}`);

  return (
    <section aria-label="Öneri panosu" className="space-y-4">
      <p className="text-sm text-text-muted">
        EmlakSoft&apos;ta ne olsun istersiniz? Öneri yazın ya da diğer ofislerin önerilerine oy verin; her ofisin bir önerideki oyu birdir. En çok oy
        alan öneriler yol haritasına öncelikle girer.
      </p>
      {canWrite ? <FeatureRequestForm /> : <p className="text-xs text-text-muted">Öneri yazmak ve oy vermek ofis sahibi ya da yöneticisi içindir.</p>}
      <nav aria-label="Öneri süzgeci" className="flex flex-wrap gap-2">
        {BOARD_FILTERS.map((f) => (
          <FilterChip key={f.id} href={hrefFor(f.id)} active={active === f.id} count={board.items.filter((i) => matches(i, f.id)).length}>
            {f.label}
          </FilterChip>
        ))}
      </nav>
      {items.length === 0 ? (
        <div className={`${PANEL} text-center`}>
          <ThumbsUp className="mx-auto h-6 w-6 text-text-faint" aria-hidden />
          <p className="mt-2 text-sm text-text-muted">
            {active === "benim" ? "Ofisinizin henüz önerisi yok. Yukarıdan ilk önerinizi yazın." : "Bu süzgeçte öneri yok."}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((i) => (
            <li key={i.id} className={`${PANEL} flex gap-4`}>
              <VoteButton id={i.id} voted={i.voted} count={i.voteCount} disabled={!canWrite || !i.canVote} />
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold text-ink-950">{i.title}</p>
                {i.body ? <p className="mt-1 whitespace-pre-line text-sm text-text-muted">{i.body}</p> : null}
                <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text-faint">
                  <span className={`rounded-full px-2 py-0.5 font-bold ${TONE[i.status]}`}>{REQUEST_STATUS_LABEL[i.status]}</span>
                  {i.mine ? <span className="font-semibold text-ink-950">Ofisinizin önerisi</span> : null}
                  <span>{fmt.format(new Date(i.createdAt))}</span>
                </p>
                {i.adminNote ? <p className="mt-2 rounded-[var(--radius-control)] bg-canvas px-3 py-2 text-xs text-text">EmlakSoft: {i.adminNote}</p> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {board.truncated ? <p className="text-xs text-text-faint">En çok oy alan 500 öneri gösteriliyor.</p> : null}
    </section>
  );
}
