import { nextActionAfterContactMs } from "./cadence";
import { MAX_FAILED_ATTEMPTS } from "./thresholds";
import type { FsboLostReason, FsboOutcome, FsboStatus } from "./types";

/**
 * Durum akışı (SAF, test edilir):
 *   yeni → arandi → randevu → yetki_alindi → portfoye_donustu
 *   her adımdan → kayip (neden zorunlu); kayip → yeni ("Yeniden dene")
 * Aranmasın durum DEĞİL bayraktır (`fsbo_do_not_call`); işaretli kayıtta arama/görev/randevu eylemleri kilitlidir.
 */
const TRANSITIONS: Record<FsboStatus, readonly FsboStatus[]> = {
  yeni: ["arandi", "randevu", "yetki_alindi", "kayip"],
  arandi: ["randevu", "yetki_alindi", "kayip"],
  randevu: ["arandi", "yetki_alindi", "kayip"],
  yetki_alindi: ["randevu", "portfoye_donustu", "kayip"],
  portfoye_donustu: [],
  kayip: ["yeni"],
};

export function canTransition(from: FsboStatus, to: FsboStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export type TransitionCheck = { ok: true } | { ok: false; error: string };

/** Elle durum değişikliği kuralları (kayıp neden ister; dönüşüm geri alınamaz). */
export function checkStatusChange(input: { from: FsboStatus; to: FsboStatus; lostReason?: FsboLostReason | null }): TransitionCheck {
  const { from, to } = input;
  if (from === "portfoye_donustu") return { ok: false, error: "Portföye dönüşen kayıt geri alınamaz." };
  if (from === to) return { ok: false, error: "Kayıt zaten bu durumda." };
  if (!canTransition(from, to)) return { ok: false, error: "Bu durum değişikliği geçerli değil." };
  if (to === "kayip" && !input.lostReason) return { ok: false, error: "Kayıp için bir neden seçin." };
  return { ok: true };
}

export type CallInput = {
  status: FsboStatus;
  contactAttempts: number;
  firstSeenMs: number;
  doNotCall: boolean;
};

export type CallResult =
  | {
      ok: true;
      status: FsboStatus;
      contactAttempts: number;
      /** Ritme göre bir sonraki arama (epoch ms); null = otomatik takip yok (randevu/yetki/aranmasın). */
      nextActionMs: number | null;
      /** Aranmasın sonucu: kayıt kayıp/emlakci_istemiyor olur ve numara listeye girer. */
      doNotCall: boolean;
      lostReason: FsboLostReason | null;
      /** Kullanıcıya öneri (otomatik uygulanmaz): ör. 6 başarısız denemeden sonra "Kayıp: ulaşılamadı". */
      suggestLost: FsboLostReason | null;
    }
  | { ok: false; error: string };

/**
 * Arama sonucu kaydı. `ulasilamadi`/`mesgul` durumu değiştirmez ama deneme sayısını artırır; `gorusuldu`, `sonra_ara`,
 * `ilgilenmiyor` yeni kaydı "arandı" yapar; `randevu`/`yetki` ilerletir; `aranmasin` kaydı kapatır.
 */
export function applyCallOutcome(
  state: CallInput,
  outcome: FsboOutcome,
  ctx: { nowMs: number; userNextMs?: number | null },
): CallResult {
  if (state.status === "portfoye_donustu") return { ok: false, error: "Portföye dönüşen kayıt için arama kaydı açılamaz." };
  if (state.status === "kayip") return { ok: false, error: "Kayıt kayıp durumda; önce \"Yeniden dene\" ile açın." };
  if (state.doNotCall && outcome !== "aranmasin") return { ok: false, error: "Bu numara aranmasın listesinde; arama kaydı açılamaz." };

  if (outcome === "aranmasin") {
    return {
      ok: true,
      status: "kayip",
      contactAttempts: state.contactAttempts + 1,
      nextActionMs: null,
      doNotCall: true,
      lostReason: "emlakci_istemiyor",
      suggestLost: null,
    };
  }

  const attempts = state.contactAttempts + 1;
  const base = { contactAttempts: attempts, doNotCall: false, lostReason: null } as const;

  if (outcome === "randevu") {
    const status: FsboStatus = state.status === "yetki_alindi" ? "yetki_alindi" : "randevu";
    return { ok: true, ...base, status, nextActionMs: null, suggestLost: null };
  }
  if (outcome === "yetki") {
    return { ok: true, ...base, status: "yetki_alindi", nextActionMs: null, suggestLost: null };
  }

  const next = nextActionAfterContactMs({
    attemptsAfter: attempts,
    firstSeenMs: state.firstSeenMs,
    nowMs: ctx.nowMs,
    userNextMs: outcome === "sonra_ara" ? ctx.userNextMs : null,
  });

  if (outcome === "ulasilamadi" || outcome === "mesgul") {
    return {
      ok: true,
      ...base,
      status: state.status,
      nextActionMs: next,
      suggestLost: outcome === "ulasilamadi" && attempts >= MAX_FAILED_ATTEMPTS ? "ulasilamadi" : null,
    };
  }

  // gorusuldu | sonra_ara | ilgilenmiyor
  const status: FsboStatus = state.status === "yeni" ? "arandi" : state.status;
  return { ok: true, ...base, status, nextActionMs: next, suggestLost: null };
}

/** Kilitli eylemler (aranmasın bayrağı): arama, görev, randevu. Not ve kayıp serbesttir. */
export function actionsLocked(input: { status: FsboStatus; doNotCall: boolean }): boolean {
  return input.doNotCall || input.status === "portfoye_donustu";
}
