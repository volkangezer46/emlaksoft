/**
 * Danışman "Bugünüm" listesi — saf kurgu (React/DB yok; vitest kapsamında). Sadeleştirme planı 2.4 / C07.
 *
 * Tek sütunlu, SIRALI tek liste: (1) bugünkü randevular (saat sırasıyla), (2) aranacaklar, (3) gecikmiş görevler.
 * Her satırda TEK eylem vardır (44 px): randevuda "Yol tarifi" (adres/konum varsa) ya da "Ara" (müşteri telefonu
 * varsa), aranacakta "Ara", görevde "Bitti". Eylemi olmayan satır kaydı açar ("Aç"). Satırın kendisi kayda gider.
 * Grup başına satır tavanı vardır (ilk ekran ≤15 etkileşimli öğe, sayfa <1600 px); kalanı "Tümü (n)" bağlantısıyla açılır.
 */

export type BugunumApptInput = {
  id: string;
  /** Sıralama anı (ms). */
  at: number;
  /** "14:00" (TR saati). */
  time: string;
  type: string;
  customer: string | null;
  phone: string | null;
  /** Yol tarifi bağlantısı (koordinat > konum metni); yoksa null. */
  directions: string | null;
  pending: boolean;
};

export type BugunumCallInput = { key: string; customerId: string | null; name: string; phone: string | null; href: string; reasons: readonly string[] };

export type BugunumTaskInput = { id: string; title: string; dueAt: string };

export type BugunumAction =
  | { kind: "yol"; label: "Yol tarifi"; href: string }
  | { kind: "ara"; label: "Ara"; href: string }
  | { kind: "bitti"; label: "Bitti"; taskId: string }
  | { kind: "ac"; label: "Aç"; href: string };

export type BugunumRow = {
  key: string;
  /** Sol sütun: saat ("14:00") ya da kısa durum ("3 gün"); aranacakta yok (ikon). */
  lead: string | null;
  title: string;
  meta: string | null;
  href: string;
  warn: boolean;
  action: BugunumAction;
};

export type BugunumGroupId = "randevu" | "ara" | "gorev";

export type BugunumGroup = {
  id: BugunumGroupId;
  title: string;
  rows: BugunumRow[];
  /** Gruptaki gerçek toplam (tavan üstü dahil); bilinmiyorsa satır sayısı. */
  total: number;
  /** "Tümü (n)" hedefi; yalnız gösterilenden fazlası varsa doludur. */
  moreHref: string | null;
};

export const BUGUNUM_CAPS: Record<BugunumGroupId, number> = { randevu: 5, ara: 3, gorev: 3 };

export const BUGUNUM_HREFS = {
  randevu: "/app/randevular",
  ara: "/app/arama-listesi",
} as const;

const telHref = (phone: string) => `tel:${phone.replace(/\s+/g, "")}`;

/** Randevu satırının TEK eylemi: yol tarifi > ara > aç. */
export function apptAction(a: Pick<BugunumApptInput, "directions" | "phone">, href: string): BugunumAction {
  if (a.directions) return { kind: "yol", label: "Yol tarifi", href: a.directions };
  if (a.phone) return { kind: "ara", label: "Ara", href: telHref(a.phone) };
  return { kind: "ac", label: "Aç", href };
}

/** Gecikme günü (TR gün başına göre; bugün içindeki gecikme 0). */
export function overdueDaysOf(dueAt: string, dayStartMs: number): number {
  const due = Date.parse(dueAt);
  if (!Number.isFinite(due)) return 0;
  return Math.max(0, Math.ceil((dayStartMs - due) / 86_400_000));
}

export function buildBugunum(input: {
  appts: readonly BugunumApptInput[];
  apptTotal: number;
  calls: readonly BugunumCallInput[];
  tasks: readonly BugunumTaskInput[];
  /** `overdueTasksCountQuery` sayısı (rozetle aynı); null = okunamadı → satır sayısı. */
  overdueCount: number | null;
  overdueHref: string;
  dayStartMs: number;
  apptHref: (id: string) => string;
  taskHref: (id: string) => string;
  caps?: Partial<Record<BugunumGroupId, number>>;
}): BugunumGroup[] {
  const caps = { ...BUGUNUM_CAPS, ...input.caps };
  const appts = [...input.appts].sort((a, b) => a.at - b.at);
  const apptRows: BugunumRow[] = appts.slice(0, caps.randevu).map((a) => {
    const href = input.apptHref(a.id);
    return {
      key: `r-${a.id}`,
      lead: a.time,
      title: a.customer ? `${a.type} · ${a.customer}` : a.type,
      meta: a.pending ? "Teyit bekliyor" : null,
      href,
      warn: a.pending,
      action: apptAction(a, href),
    };
  });
  // Bugün randevusu olan müşteri "aranacaklar"da tekrar edilmez (aynı kişi iki satır olmaz).
  const apptPeople = new Set(appts.map((a) => a.customer?.trim().toLocaleLowerCase("tr-TR")).filter(Boolean));
  const calls = input.calls.filter((c) => !apptPeople.has(c.name.trim().toLocaleLowerCase("tr-TR")));
  const callRows: BugunumRow[] = calls.slice(0, caps.ara).map((c) => ({
    key: `a-${c.key}`,
    lead: null,
    title: c.name,
    meta: c.reasons[0] ?? null,
    href: c.href,
    warn: false,
    action: c.phone ? { kind: "ara", label: "Ara", href: telHref(c.phone) } : { kind: "ac", label: "Aç", href: c.href },
  }));
  const taskRows: BugunumRow[] = input.tasks.slice(0, caps.gorev).map((t) => {
    const days = overdueDaysOf(t.dueAt, input.dayStartMs);
    return {
      key: `g-${t.id}`,
      lead: days > 0 ? `${days} gün` : "Bugün",
      title: t.title,
      meta: days > 0 ? `${days} gün gecikti` : "Saati geçti",
      href: input.taskHref(t.id),
      warn: true,
      action: { kind: "bitti", label: "Bitti", taskId: t.id },
    };
  });
  const apptTotal = Math.max(input.apptTotal, appts.length);
  const taskTotal = input.overdueCount ?? input.tasks.length;
  const groups: BugunumGroup[] = [
    { id: "randevu", title: "Bugünkü randevular", rows: apptRows, total: apptTotal, moreHref: apptTotal > apptRows.length ? BUGUNUM_HREFS.randevu : null },
    { id: "ara", title: "Aranacaklar", rows: callRows, total: calls.length, moreHref: calls.length > callRows.length ? BUGUNUM_HREFS.ara : null },
    { id: "gorev", title: "Gecikmiş görevler", rows: taskRows, total: taskTotal, moreHref: taskTotal > taskRows.length ? input.overdueHref : null },
  ];
  return groups.filter((g) => g.rows.length > 0);
}

/** Listedeki satır sayısı (boş durum kararı ve ölçüm için). */
export function bugunumRowCount(groups: readonly BugunumGroup[]): number {
  return groups.reduce((n, g) => n + g.rows.length, 0);
}
