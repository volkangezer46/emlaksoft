import { DAY_MS } from "@/lib/clock";
import { CLAIM_IDLE_DAYS } from "./thresholds";

/**
 * Çakışma tespiti (SAF). Kayıt anında dört çakışma bakılır; hiçbiri kaydı ENGELLEMEZ (yalnız uyarır/bağlar),
 * ancak ofis içi sahiplik ikinci danışmanın aynı ilanı sahiplenmesini önler.
 */

export type OwnershipInput = {
  assignedTo: string | null;
  assignedName: string | null;
  /** Son etkinlik (epoch ms): sahiplik hareketsizlikte düşer. */
  lastActivityMs: number;
  claimExpiresMs: number | null;
};

export type OwnershipVerdict =
  | { kind: "free" }
  | { kind: "mine" }
  | { kind: "other"; name: string | null; daysAgo: number; message: string };

/** Aynı ilan ofiste zaten kayıtlıysa kimin elinde olduğu ("Ayşe 2 gün önce kaydetti, ilgileniyor"). */
export function ownershipVerdict(lead: OwnershipInput, userId: string, nowMs: number, opts: { canOverride: boolean }): OwnershipVerdict {
  if (!lead.assignedTo) return { kind: "free" };
  if (lead.assignedTo === userId) return { kind: "mine" };
  const expired = lead.claimExpiresMs != null && lead.claimExpiresMs <= nowMs;
  const idle = nowMs - lead.lastActivityMs >= CLAIM_IDLE_DAYS * DAY_MS;
  // Yönetici kaydı devralabilir; hareketsizlikten düşen sahiplik de serbest sayılır.
  if (opts.canOverride || expired || idle) return { kind: "free" };
  const daysAgo = Math.max(0, Math.floor((nowMs - lead.lastActivityMs) / DAY_MS));
  const who = lead.assignedName ?? "Başka bir danışman";
  const when = daysAgo === 0 ? "bugün" : `${daysAgo} gün önce`;
  return { kind: "other", name: lead.assignedName, daysAgo, message: `${who} bu ilanı ${when} kaydetti ve ilgileniyor.` };
}

export type ConflictFacts = {
  /** Telefon özeti aranmasın listesinde. */
  doNotCall: boolean;
  /** Aynı numaraya sahip mevcut müşteri. */
  customer: { id: string; name: string; type: string | null } | null;
  /** Ofisin portföyünde/portal ilanında aynı ilan no ya da bağlantı. */
  ownListing: { propertyId: string } | null;
};

export type ConflictNotice = { key: "do_not_call" | "customer" | "own_listing"; message: string; href: string | null };

/** Kullanıcıya gösterilecek çakışma uyarıları (sıra: aranmasın > portföy > müşteri). */
export function conflictNotices(f: ConflictFacts): ConflictNotice[] {
  const out: ConflictNotice[] = [];
  if (f.doNotCall) out.push({ key: "do_not_call", message: "Bu numara ofisinizde \"Aranmasın\" olarak işaretli; arama eylemleri kilitli.", href: null });
  if (f.ownListing) out.push({ key: "own_listing", message: "Bu ilan zaten ofisinizin portföyünde.", href: `/app/portfoyler/${f.ownListing.propertyId}` });
  if (f.customer) {
    const type = f.customer.type ? ` (${f.customer.type})` : "";
    out.push({ key: "customer", message: `Bu numara ${f.customer.name}${type} kaydında.`, href: `/app/musteriler/${f.customer.id}` });
  }
  return out;
}
