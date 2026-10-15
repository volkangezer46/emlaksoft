/**
 * Birebir koçluk görüşmesi (OA8) — SAF yardımcılar (veri çekmez). Görüşme başlarken danışmanın o anki karnesi
 * anlık görüntü olarak saklanır; istemciden gelen değer yalnız bilinen sayısal alanlarla kabul edilir.
 */

export const COACHING_ROLES = ["owner", "gm", "branch_manager"] as const;

export function canCoach(role: string | null | undefined): boolean {
  return (COACHING_ROLES as readonly string[]).includes(String(role ?? ""));
}

export const SNAPSHOT_FIELDS = [
  { key: "newCustomers", label: "Yeni müşteri" },
  { key: "appointments", label: "Randevu" },
  { key: "offers", label: "Teklif" },
  { key: "deals", label: "Anlaşma" },
  { key: "calls", label: "Arama" },
  { key: "overdueTasks", label: "Geciken görev" },
  { key: "staleCustomers", label: "30+ gün sessiz müşteri" },
] as const;

export type SnapshotKey = (typeof SNAPSHOT_FIELDS)[number]["key"];
export type CoachingSnapshot = Partial<Record<SnapshotKey, number>> & { month?: string };

/** Güvenilmeyen JSON → yalnız bilinen alanlar, 0..100000 tam sayılar; ay "YYYY-MM". */
export function sanitizeSnapshot(raw: unknown): CoachingSnapshot {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!obj || typeof obj !== "object") return {};
  const o = obj as Record<string, unknown>;
  const out: CoachingSnapshot = {};
  for (const f of SNAPSHOT_FIELDS) {
    const n = Number(o[f.key]);
    if (Number.isInteger(n) && n >= 0 && n <= 100_000) out[f.key] = n;
  }
  if (typeof o.month === "string" && /^\d{4}-\d{2}$/.test(o.month)) out.month = o.month;
  return out;
}

export type CommitmentInput = { body: string; dueOn: string | null; asTask: boolean };

/** Form satırları → geçerli taahhütler (boş satır atlanır, en çok 10, metin 300 karakter, tarih YYYY-MM-DD ya da yok). */
export function parseCommitments(bodies: readonly unknown[], dues: readonly unknown[], tasks: readonly unknown[]): CommitmentInput[] {
  const out: CommitmentInput[] = [];
  bodies.forEach((b, i) => {
    const body = String(b ?? "").trim().slice(0, 300);
    if (!body || out.length >= 10) return;
    const due = String(dues[i] ?? "").trim();
    out.push({ body, dueOn: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null, asTask: String(tasks[i] ?? "") === "1" });
  });
  return out;
}

/** Son birebirden bu yana gün (yoksa null). İçgörü ve rozet için: 21 gün üstü "birebir gecikti". */
export const COACHING_STALE_DAYS = 21;
export function daysSince(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((nowMs - t) / 86_400_000));
}
