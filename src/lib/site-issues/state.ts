import { fingerprintOf, normalizeUrlForFingerprint } from "./fingerprint";
import { ISSUE_LIMITS, type CollectorResult, type IssueInput, type IssueStatus, type SiteIssue } from "./types";

/**
 * Bulgu DURUM MAKİNESİ (SAF). Olaylar:
 *  - seen: toplayıcı bulguyu yine gördü    - gone: taranan URL'de bulgu artık yok
 *  - propose: öneri hazırlandı              - draft: düzeltme taslağa alındı
 *  - publish: taslak yayınlandı             - ignore: gerekçeyle yoksayıldı      - unignore: yoksaymadan geri alındı
 * Tabloda olmayan geçiş geçersizdir (`null`); çağıran durumu değiştirmez. "yoksayildi" toplayıcı olaylarıyla değişmez.
 */
export type IssueEvent = "seen" | "gone" | "propose" | "draft" | "publish" | "ignore" | "unignore";

const OPEN_LIKE = (seen: IssueStatus): Partial<Record<IssueEvent, IssueStatus>> => ({
  seen,
  gone: "dogrulandi",
  propose: "onerildi",
  draft: "taslakta",
  publish: "yayinda",
  ignore: "yoksayildi",
});

export const TRANSITIONS: Record<IssueStatus, Partial<Record<IssueEvent, IssueStatus>>> = {
  acik: OPEN_LIKE("acik"),
  yeniden_acildi: OPEN_LIKE("yeniden_acildi"),
  onerildi: OPEN_LIKE("onerildi"),
  taslakta: { seen: "taslakta", gone: "dogrulandi", draft: "taslakta", publish: "yayinda", ignore: "yoksayildi" },
  // Yayından sonra robot yeniden taramadıysa bulgu hâlâ görünebilir: doğrulama bir sonraki taramayı bekler.
  yayinda: { seen: "yayinda", gone: "dogrulandi", ignore: "yoksayildi" },
  dogrulandi: { seen: "yeniden_acildi", gone: "dogrulandi" },
  yoksayildi: { seen: "yoksayildi", gone: "yoksayildi", unignore: "acik" },
};

export function nextStatus(current: IssueStatus, event: IssueEvent): IssueStatus | null {
  return TRANSITIONS[current]?.[event] ?? null;
}

/** Kuyrukta "açık iş" sayılan durumlar (Site notunu düşürür). */
export const ACTIVE_STATUSES: readonly IssueStatus[] = ["acik", "yeniden_acildi", "onerildi", "taslakta", "yayinda"];

export function isActiveStatus(s: IssueStatus): boolean {
  return ACTIVE_STATUSES.includes(s);
}

export const STATUS_LABEL: Record<IssueStatus, string> = {
  acik: "Açık",
  onerildi: "Öneri hazır",
  taslakta: "Taslakta",
  yayinda: "Yayında, doğrulama bekliyor",
  dogrulandi: "Doğrulandı",
  yeniden_acildi: "Yeniden açıldı",
  yoksayildi: "Yoksayıldı",
};

/* ---------- Toplayıcı sonucunu mevcut kayıtlarla birleştirme (SAF) ---------- */

export type IssueRowWrite = Omit<SiteIssue, "id"> & { id?: string };

export type MergePlan = {
  /** Yeni bulgular (durum "acik"). */
  inserts: IssueRowWrite[];
  /** Görülen ya da kapanan mevcut bulgular (id'li tam satır). */
  updates: IssueRowWrite[];
  counts: { yeni: number; gorulen: number; dogrulandi: number; yenidenAcildi: number; dokunulmadi: number };
};

const clip = (v: string | null | undefined, n: number) => String(v ?? "").slice(0, n);

type InputFields = Pick<SiteIssue, "area" | "url" | "code" | "severity" | "title" | "explain" | "fingerprint" | "collector" | "evidence" | "proposal" | "href" | "manual_only">;

/** Toplayıcı girdisini saklanacak alanlara indirger (sınırlar DB CHECK ile aynı). */
export function sanitizeInput(input: IssueInput, collector: string): InputFields {
  const url = normalizeUrlForFingerprint(input.url);
  const code = clip(input.code, ISSUE_LIMITS.code);
  return {
    area: input.area,
    url,
    code,
    severity: input.severity,
    title: clip(input.title, ISSUE_LIMITS.title) || code,
    explain: clip(input.explain, ISSUE_LIMITS.explain),
    fingerprint: fingerprintOf(input.area, code, url),
    collector: clip(collector, ISSUE_LIMITS.collector),
    evidence: input.evidence ?? null,
    proposal: input.proposal ?? null,
    href: input.href ? clip(input.href, ISSUE_LIMITS.href) : null,
    manual_only: Boolean(input.manualOnly),
  };
}

/**
 * `existing`: bu toplayıcının mevcut kayıtları. Kurallar:
 *  - yeni bulgu "acik"; görülen bulgunun last_seen'i (ve metinleri) güncellenir; "dogrulandi" iken görülen "yeniden_acildi" olur;
 *  - kaybolan bulgu YALNIZ `scanned` içinde (ya da "all") taranmış URL için "dogrulandi" olur; taranmayan URL'nin bulgusu açık kalır;
 *  - "yoksayildi" korunur (gerekçe ve yoksayan silinmez).
 */
export function planCollectorMerge(existing: readonly SiteIssue[], result: CollectorResult, nowIso: string): MergePlan {
  const plan: MergePlan = { inserts: [], updates: [], counts: { yeni: 0, gorulen: 0, dogrulandi: 0, yenidenAcildi: 0, dokunulmadi: 0 } };
  const byFp = new Map(existing.map((r) => [r.fingerprint, r]));
  const seen = new Set<string>();
  const scannedAll = result.scanned === "all";
  const scanned = new Set(result.scanned === "all" ? [] : result.scanned.map(normalizeUrlForFingerprint));

  for (const input of result.issues) {
    const row = sanitizeInput(input, result.collector);
    if (seen.has(row.fingerprint)) continue;
    seen.add(row.fingerprint);
    const prev = byFp.get(row.fingerprint);
    if (!prev) {
      plan.inserts.push({
        ...row,
        status: "acik",
        first_seen: nowIso,
        last_seen: nowIso,
        resolved_at: null,
        ignored_by: null,
        ignored_reason: null,
        publish_ref: null,
      });
      plan.counts.yeni++;
      continue;
    }
    const status = nextStatus(prev.status, "seen") ?? prev.status;
    if (prev.status === "dogrulandi" && status === "yeniden_acildi") plan.counts.yenidenAcildi++;
    else plan.counts.gorulen++;
    // Yoksayılmış bulgunun gerekçesi/yoksayanı ve taslak/yayın bağı korunur; yalnız metin, kanıt ve görülme zamanı tazelenir.
    plan.updates.push({ ...prev, ...row, status, last_seen: nowIso, resolved_at: status === "yeniden_acildi" ? null : prev.resolved_at });
  }

  for (const prev of existing) {
    if (seen.has(prev.fingerprint)) continue;
    const wasScanned = scannedAll || scanned.has(normalizeUrlForFingerprint(prev.url));
    const next = wasScanned ? nextStatus(prev.status, "gone") : null;
    if (!next || next === prev.status) {
      plan.counts.dokunulmadi++;
      continue;
    }
    plan.updates.push({ ...prev, status: next, resolved_at: nowIso });
    plan.counts.dogrulandi++;
  }
  return plan;
}
