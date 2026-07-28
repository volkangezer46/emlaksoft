/**
 * Anlaşma detayının AKAN bölümleri.
 *
 * NEDEN: `page.tsx` sonunda evrak listesi, işlem dosyası ve not akışı ARDIŞIK
 * üç `await` ile çekiliyordu — üç ayrı gidiş-dönüş, üstelik künye çoktan
 * hazırken. Üçü de birbirinden ve künyeden bağımsız; artık kendi `<Suspense>`
 * sınırlarında paralel akıyorlar.
 *
 * Görünüm değişmedi: bileşenler ve props'ları aynı, yalnız veri okuma noktası
 * sayfadan buraya taşındı.
 */
import { createClient } from "@/lib/supabase/server";
import type { DealCost, DealNote } from "@/app/actions/deals";
import type { ChecklistItem } from "@/app/actions/deal-checklist";
import { DealCostsSection } from "./deal-costs-section";
import { DealNotesSection } from "./deal-notes-section";
import { DealChecklistSection } from "./deal-checklist-section";

/** supabase-js gömülü ilişkiyi dizi olarak tipleyebilir; iki biçimi de karşıla. */
function rel<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-[var(--radius-panel)] bg-ink-950/[0.06] ${className}`} aria-hidden />;
}

export const ChecklistSkeleton = () => <Skeleton className="h-56" />;
export const CostsSkeleton = () => <Skeleton className="h-56" />;
export const NotesSkeleton = () => <Skeleton className="h-64" />;

/**
 * Evrak kontrol listesi (deal_checklist_items — migration 20260727000103).
 * done_by profil join'i işaretleyenin adı için; tablo yoksa data null kalır
 * ve bölüm boş listeyle render edilir — sayfa kırılmaz.
 */
export async function ChecklistLoader({
  dealId,
  dealType,
  canEdit,
}: {
  dealId: string;
  dealType: string;
  canEdit: boolean;
}) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("deal_checklist_items")
    .select("id, label, is_required, is_done, done_at, note, sort_order, done_by:profiles(full_name)")
    .eq("deal_id", dealId)
    .order("sort_order", { ascending: true });

  const items: ChecklistItem[] = (data ?? []).map((r) => {
    const doneBy = rel(r.done_by as { full_name?: string } | { full_name?: string }[] | null);
    return {
      id: r.id as string,
      label: r.label as string,
      is_required: Boolean(r.is_required),
      is_done: Boolean(r.is_done),
      done_at: (r.done_at as string | null) ?? null,
      done_by_name: doneBy?.full_name ?? null,
      note: (r.note as string | null) ?? null,
      sort_order: Number(r.sort_order ?? 0),
    };
  });

  return <DealChecklistSection dealId={dealId} dealType={dealType} items={items} canEdit={canEdit} />;
}

/**
 * İşlem dosyası kalemleri (deal_costs — migration 20260726000069).
 * Tablo henüz oluşmadıysa sorgu hata döner; data null kalır ve bölüm
 * boş listeyle render edilir — sayfa asla kırılmaz.
 */
export async function CostsLoader({ dealId, canEdit }: { dealId: string; canEdit: boolean }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("deal_costs")
    .select("id, kind, label, amount, paid, paid_at, notes, created_at")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: true });

  return <DealCostsSection dealId={dealId} costs={(data as DealCost[] | null) ?? []} canEdit={canEdit} />;
}

/**
 * Not/yorum akışı (deal_notes — migration 20260726000094). Kronolojik
 * (eski → yeni); yazar adı profiles join'inden. Tablo yoksa data null
 * kalır ve bölüm boş akışla render edilir — sayfa kırılmaz.
 */
export async function NotesLoader({
  dealId,
  canEdit,
  currentUserId,
}: {
  dealId: string;
  canEdit: boolean;
  currentUserId: string | null;
}) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("deal_notes")
    .select("id, body, author_id, created_at, author:profiles(full_name)")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: true })
    .limit(200);

  const notes: DealNote[] = (data ?? []).map((n) => {
    const a = rel(n.author as { full_name?: string } | { full_name?: string }[] | null);
    return {
      id: n.id as string,
      body: n.body as string,
      author_id: (n.author_id as string | null) ?? null,
      author_name: a?.full_name ?? null,
      created_at: n.created_at as string,
    };
  });

  return <DealNotesSection dealId={dealId} notes={notes} canEdit={canEdit} currentUserId={currentUserId} />;
}
