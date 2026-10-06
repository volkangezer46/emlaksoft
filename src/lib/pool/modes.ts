import { trParts } from "@/lib/clock";
import type { Availability, PoolSuggestion } from "./score";

/** Havuz atama modları (assignment_rules.assign_mode). */
export type PoolMode = "manual" | "semi_auto" | "auto" | "claim";

export const POOL_MODES: readonly { value: PoolMode; label: string; desc: string }[] = [
  { value: "manual", label: "Manuel", desc: "Öneriler sıralanır, atamayı ofis sahibi seçer." },
  { value: "semi_auto", label: "Yarı otomatik", desc: "En iyi 3 öneri ve tek tıkla onay (önerilen)." },
  { value: "auto", label: "Otomatik", desc: "Puan eşiği aşılırsa sistem atar; altında havuzda bekler." },
  { value: "claim", label: "Sahiplenme", desc: "Süre dolana dek uygun danışmanlardan ilk sahiplenen alır." },
];

export function isPoolMode(v: unknown): v is PoolMode {
  return v === "manual" || v === "semi_auto" || v === "auto" || v === "claim";
}

export type PoolDecision =
  | { kind: "auto_assign"; profileId: string; score: number }
  | { kind: "open_claim"; claimOpenUntilMs: number; eligibleProfileIds: string[] }
  | { kind: "await_owner"; reason: "manual" | "semi_auto" | "below_threshold" | "no_candidates" };

/** Mod + öneri listesi + eşik -> kayıt açılırken uygulanacak işlem. Saf: saat dışarıdan verilir. */
export function decidePoolAction(input: {
  mode: PoolMode;
  suggestions: PoolSuggestion[];
  minScore: number | null;
  slaMinutes: number | null;
  nowMs: number;
}): PoolDecision {
  const eligible = input.suggestions.filter((s) => !s.excluded);
  if (!eligible.length) return { kind: "await_owner", reason: "no_candidates" };
  switch (input.mode) {
    case "auto": {
      const top = eligible[0];
      const threshold = input.minScore ?? 60;
      if (top.score >= threshold) return { kind: "auto_assign", profileId: top.profileId, score: top.score };
      return { kind: "await_owner", reason: "below_threshold" };
    }
    case "claim": {
      const minutes = input.slaMinutes && input.slaMinutes > 0 ? input.slaMinutes : 30;
      return {
        kind: "open_claim",
        claimOpenUntilMs: input.nowMs + minutes * 60_000,
        eligibleProfileIds: eligible.map((s) => s.profileId),
      };
    }
    case "semi_auto":
      return { kind: "await_owner", reason: "semi_auto" };
    default:
      return { kind: "await_owner", reason: "manual" };
  }
}

/**
 * Toplu giriş (içe aktarma) kararı: aynı anda onlarca ilan aynı aday listesiyle puanlandığı için otomatik atama
 * hepsini tek danışmana yığar (açık ilan sayısı ilanlar arasında güncellenmez). Toplu girişte otomatik atama
 * YAPILMAZ; en iyi öneri yöneticinin tek tık onayına düşer. Sahiplenme ve bekleme kararları aynen kalır.
 */
export function bulkPoolDecision(decision: PoolDecision): PoolDecision {
  return decision.kind === "auto_assign" ? { kind: "await_owner", reason: "semi_auto" } : decision;
}

export type SlaState = "none" | "ok" | "due_soon" | "breached";

/** SLA durumu: süre yoksa none; dolmuşsa breached; son %20 (en çok 15 dk) kala due_soon. */
export function slaState(input: { dueMs: number | null; createdMs: number; nowMs: number }): SlaState {
  if (input.dueMs == null) return "none";
  if (input.nowMs >= input.dueMs) return "breached";
  const total = Math.max(input.dueMs - input.createdMs, 1);
  const soon = Math.min(total * 0.2, 15 * 60_000);
  return input.dueMs - input.nowMs <= soon ? "due_soon" : "ok";
}

/** Sahiplenme penceresi açık mı (RPC kuralıyla aynı: dolmamış). */
export function isClaimOpen(claimOpenUntilMs: number | null, nowMs: number): boolean {
  return claimOpenUntilMs != null && claimOpenUntilMs >= nowMs;
}

/** Mesai: hafta içi 09:00-18:00 (Türkiye saati) içinde; hafta içi dışında mesai dışı; hafta sonu "off". */
export function availabilityAt(nowMs: number): Availability {
  const t = trParts(nowMs);
  if (t.weekday === 0 || t.weekday === 6) return "off";
  return t.hour >= 9 && t.hour < 18 ? "in_hours" : "out_of_hours";
}
