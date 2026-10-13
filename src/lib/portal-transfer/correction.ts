import type { ControlDescriptor, FillAction } from "./fill-plan";
import type { ReadValue } from "./page-fns";
import { fold, type FillFieldKey } from "./rules";

/**
 * DÜZELTME SİNYALİ (SAF, testli). Doldurmadan hemen sonra alınan anlık görüntü (`chrome.storage.session`, ham değer YOK:
 * metinde FNV-1a özeti + rakam özeti, seçimde portalın seçenek metni) ile "Yayından önce kontrol et" / "EmlakSoft'a bağla"
 * anındaki okuma karşılaştırılır. Sonuç alan başına: kabul edildi, düzeltildi (başka seçenek / değer düzenlendi: biçim mi
 * yeniden yazım mı), boşaltıldı ya da bulunamadı. Sayfa yeniden çizildiyse (sıra numaraları kaydı) alan, imzasıyla yeniden bulunur.
 */

export type SnapshotItem = {
  /** Doldurma anındaki denetim sırası (radyoda tıklanan üye). */
  idx: number;
  sig: string;
  key: FillFieldKey;
  kind: "text" | "select" | "bool";
  valueHash?: string;
  digitsHash?: string;
  /** Katlanmış seçenek metni (select ve radyo). */
  option?: string;
  checked?: boolean;
  /** Radyo grubunun üyeleri (doldurma anındaki sıra numaraları). */
  group?: number[];
};

export type FillSnapshot = { sessionId: string; portal: string; ruleVersion: number; ruleSha?: string | null; at: number; items: SnapshotItem[] };

export type Correction = { kind: "other_option"; option: string } | { kind: "value_edited"; category: "format" | "rewritten" };
export type FieldOutcome = { sig: string; key: FillFieldKey; outcome: "accepted" | "corrected" | "cleared" | "not_found"; correction?: Correction };

/** Şimdiki sayfadaki imzalı şema (form-signature `SignedShape` alt kümesi). */
export type ShapeRef = { sig: string; idxs: number[] };

/** FNV-1a 32 bit; `page-fns.ts: readValuesInPage` içindeki kopyayla birebir aynı (test kilitler). */
export function fnv1a32(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Uygulanan eylemlerden ve doldurma SONRASI okumadan anlık görüntü kurar. Yalnız başarıyla uygulanan alanlar girer; imzası
 * olmayan (kişisel/şema dışı) denetim girmez.
 */
export function buildSnapshot(
  meta: { sessionId: string; portal: string; ruleVersion: number; ruleSha?: string | null; at: number },
  actions: readonly FillAction[],
  applied: readonly { idx: number; ok: boolean }[],
  readValues: readonly ReadValue[],
  shapes: ReadonlyMap<number, ShapeRef>,
  descs: readonly ControlDescriptor[],
): FillSnapshot {
  const ok = new Set(applied.filter((r) => r.ok).map((r) => r.idx));
  const read = new Map(readValues.map((r) => [r.idx, r]));
  const byIdx = new Map(descs.map((d) => [d.idx, d]));
  const items: SnapshotItem[] = [];
  for (const a of actions) {
    const shape = shapes.get(a.idx);
    const desc = byIdx.get(a.idx);
    if (!ok.has(a.idx) || !shape || !desc) continue;
    const base = { idx: a.idx, sig: shape.sig, key: a.field };
    if (desc.type === "radio") {
      items.push({ ...base, kind: "select", option: fold(desc.optionText).slice(0, 60), group: [...shape.idxs] });
      continue;
    }
    const r = read.get(a.idx);
    if (!r || r.kind === "missing") continue;
    if (r.kind === "select") items.push({ ...base, kind: "select", option: fold(r.option).slice(0, 60) });
    else if (r.kind === "bool") items.push({ ...base, kind: "bool", checked: r.checked === true });
    else items.push({ ...base, kind: "text", ...(r.valueHash ? { valueHash: r.valueHash } : {}), ...(r.digitsHash ? { digitsHash: r.digitsHash } : {}) });
  }
  return { ...meta, items };
}

/**
 * Anlık görüntüdeki her alanın ŞİMDİKİ sırasını bulur: aynı sırada aynı imza varsa o; yoksa imzasıyla TEK eşleşen şema
 * (radyoda gruptaki aynı konum). Birden çok aday ya da hiç aday yoksa null (bulunamadı; tahmin yok).
 */
export function resolveSnapshotIdx(snapshot: FillSnapshot, now: ReadonlyMap<number, ShapeRef>): Map<number, ShapeRef & { idx: number } | null> {
  const shapes = Array.from(new Set(now.values()));
  const out = new Map<number, (ShapeRef & { idx: number }) | null>();
  for (const it of snapshot.items) {
    const same = now.get(it.idx);
    let shape: ShapeRef | null = same && same.sig === it.sig ? same : null;
    if (!shape) {
      const cands = shapes.filter((s) => s.sig === it.sig);
      shape = cands.length === 1 ? cands[0]! : null;
    }
    if (!shape) {
      out.set(it.idx, null);
      continue;
    }
    if (it.group) {
      const pos = it.group.indexOf(it.idx);
      const idx = pos >= 0 && pos < shape.idxs.length ? shape.idxs[pos]! : null;
      out.set(it.idx, idx === null ? null : { ...shape, idx });
    } else out.set(it.idx, { ...shape, idx: shape.idxs[0]! });
  }
  return out;
}

/** Okunacak sıra numaraları (radyo gruplarının tüm üyeleri dahil). */
export function idxsToRead(resolved: ReadonlyMap<number, (ShapeRef & { idx: number }) | null>): number[] {
  const set = new Set<number>();
  for (const r of resolved.values()) {
    if (!r) continue;
    set.add(r.idx);
    if (r.idxs.length > 1) for (const i of r.idxs) set.add(i);
  }
  return Array.from(set).sort((a, b) => a - b);
}

/**
 * Anlık görüntü ↔ şimdiki okuma farkı. `now`: şimdiki sayfanın imzalı şeması (sıra → şema) ve betimleyicileri (radyo seçenek
 * metni için). Metinde rakam özeti aynıysa düzeltme "format" (ör. 1500000 → 1.500.000), değilse "rewritten".
 */
export function diffSnapshot(
  snapshot: FillSnapshot,
  readValues: readonly ReadValue[],
  now: { shapes: ReadonlyMap<number, ShapeRef>; descs: readonly ControlDescriptor[] },
): FieldOutcome[] {
  const resolved = resolveSnapshotIdx(snapshot, now.shapes);
  const read = new Map(readValues.map((r) => [r.idx, r]));
  const descs = new Map(now.descs.map((d) => [d.idx, d]));
  const out: FieldOutcome[] = [];
  for (const it of snapshot.items) {
    const base = { sig: it.sig, key: it.key };
    const at = resolved.get(it.idx) ?? null;
    if (!at) {
      out.push({ ...base, outcome: "not_found" });
      continue;
    }
    if (it.group) {
      const checked = at.idxs.find((i) => read.get(i)?.checked === true);
      if (checked === undefined) out.push({ ...base, outcome: "cleared" });
      else if (checked === at.idx) out.push({ ...base, outcome: "accepted" });
      else out.push({ ...base, outcome: "corrected", correction: { kind: "other_option", option: fold(descs.get(checked)?.optionText).slice(0, 60) } });
      continue;
    }
    const r = read.get(at.idx);
    if (!r || r.kind === "missing") {
      out.push({ ...base, outcome: "not_found" });
      continue;
    }
    if (it.kind === "select") {
      const opt = fold(r.option).slice(0, 60);
      if (!opt || /^(seciniz|sec|secim yapiniz|lutfen seciniz|seciniz lutfen)$/.test(opt)) out.push({ ...base, outcome: "cleared" });
      else if (opt === it.option) out.push({ ...base, outcome: "accepted" });
      else out.push({ ...base, outcome: "corrected", correction: { kind: "other_option", option: opt } });
      continue;
    }
    if (it.kind === "bool") {
      if (r.checked === it.checked) out.push({ ...base, outcome: "accepted" });
      else if (it.checked && !r.checked) out.push({ ...base, outcome: "cleared" });
      else out.push({ ...base, outcome: "corrected", correction: { kind: "value_edited", category: "rewritten" } });
      continue;
    }
    if (!r.valueHash) out.push({ ...base, outcome: it.valueHash ? "cleared" : "accepted" });
    else if (r.valueHash === it.valueHash) out.push({ ...base, outcome: "accepted" });
    else {
      const format = Boolean(r.digitsHash) && r.digitsHash === it.digitsHash;
      out.push({ ...base, outcome: "corrected", correction: { kind: "value_edited", category: format ? "format" : "rewritten" } });
    }
  }
  return out;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_RE = /^[0-9a-f]{8}$/;
const SIG_RE = /^[0-9a-f]{64}$/;

/**
 * Oturum deposuna yazılmadan önce anlık görüntüyü beyaz listeyle yeniden kurar (arka plan; güvenmeden). Yalnız özet,
 * seçenek metni ve işaret alanları kalır; başka anahtar (ör. ham değer) taşınamaz.
 */
export function sanitizeSnapshot(raw: unknown): FillSnapshot | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.sessionId !== "string" || !UUID_RE.test(r.sessionId) || typeof r.portal !== "string" || !Array.isArray(r.items)) return null;
  const ruleVersion = typeof r.ruleVersion === "number" && Number.isInteger(r.ruleVersion) && r.ruleVersion >= 0 ? r.ruleVersion : 0;
  const at = typeof r.at === "number" && Number.isFinite(r.at) ? r.at : 0;
  const items: SnapshotItem[] = [];
  for (const x of r.items.slice(0, 120)) {
    const it = (x ?? {}) as Record<string, unknown>;
    if (!Number.isInteger(it.idx) || (it.idx as number) < 0 || typeof it.sig !== "string" || !SIG_RE.test(it.sig) || typeof it.key !== "string" || !/^[a-z_]{1,40}$/.test(it.key)) continue;
    const kind = it.kind === "text" || it.kind === "select" || it.kind === "bool" ? it.kind : null;
    if (!kind) continue;
    const item: SnapshotItem = { idx: it.idx as number, sig: it.sig, key: it.key as FillFieldKey, kind };
    if (typeof it.valueHash === "string" && HASH_RE.test(it.valueHash)) item.valueHash = it.valueHash;
    if (typeof it.digitsHash === "string" && HASH_RE.test(it.digitsHash)) item.digitsHash = it.digitsHash;
    if (typeof it.option === "string") item.option = fold(it.option).slice(0, 60);
    if (typeof it.checked === "boolean") item.checked = it.checked;
    if (Array.isArray(it.group)) item.group = it.group.filter((g): g is number => Number.isInteger(g) && (g as number) >= 0).slice(0, 40);
    items.push(item);
  }
  const ruleSha = typeof r.ruleSha === "string" && /^[0-9a-f]{16,64}$/.test(r.ruleSha) ? r.ruleSha : null;
  return { sessionId: r.sessionId, portal: r.portal.slice(0, 20), ruleVersion, ruleSha, at, items };
}

/** Kullanıcıya özet: kaç alanı değiştirdi / boşalttı. */
export function correctionSummary(outcomes: readonly FieldOutcome[]): { changed: number; cleared: number; accepted: number; missing: number } {
  return {
    changed: outcomes.filter((o) => o.outcome === "corrected").length,
    cleared: outcomes.filter((o) => o.outcome === "cleared").length,
    accepted: outcomes.filter((o) => o.outcome === "accepted").length,
    missing: outcomes.filter((o) => o.outcome === "not_found").length,
  };
}

/**
 * (K3 yeniden doldurma) Önceki doldurmanın yazdığı ve kullanıcının o zamandan beri DEĞİŞTİRMEDİĞİ (accepted) metin ve
 * seçim denetimlerinin ŞİMDİKİ sıraları. Yeniden doldurmada yalnız bunlar "boş" sayılır (`releaseOwned`): dolu alana
 * dokunmama ilkesi yalnız eklentinin kendi yazdığı, el değmemiş değerler için gevşer. Radyo dahil edilmez (yeni seçime
 * tıklamak eskisini zaten bırakır); onay kutusu dahil edilmez (yeniden tıklamak tersine çevirir).
 */
export function untouchedOwnIdxs(
  snapshot: FillSnapshot,
  readValues: readonly ReadValue[],
  now: { shapes: ReadonlyMap<number, ShapeRef>; descs: readonly ControlDescriptor[] },
): number[] {
  const resolved = resolveSnapshotIdx(snapshot, now.shapes);
  const outcomes = diffSnapshot(snapshot, readValues, now); // snapshot.items ile aynı sırada, öğe başına bir sonuç
  const out = new Set<number>();
  snapshot.items.forEach((it, i) => {
    const at = resolved.get(it.idx);
    if (!at || it.group || it.kind === "bool" || outcomes[i]?.outcome !== "accepted") return;
    out.add(at.idx);
  });
  return Array.from(out).sort((a, b) => a - b);
}

/** Verilen sıralardaki metin/seçim denetimlerini plan için boş gösterir (sayfaya dokunmaz; yalnız betimleyici kopyası). */
export function releaseOwned(descs: readonly ControlDescriptor[], idxs: readonly number[]): ControlDescriptor[] {
  const own = new Set(idxs);
  return descs.map((d) => (own.has(d.idx) && d.type !== "checkbox" && d.type !== "radio" ? { ...d, current: "" } : d));
}

/**
 * Yeniden doldurmanın anlık görüntüsünü öncekiyle BİRLEŞTİRİR (üzerine yazmaz): yeni öğeler + önceki öğelerden şimdiki
 * sayfada imzasıyla bulunan, yeni turun dokunmadığı (aynı denetim ya da aynı alan değil) olanlar şimdiki sıraya taşınarak.
 * Farklı oturum/portal ise yalnız yeni görüntü.
 */
export function mergeSnapshots(prev: FillSnapshot | null, next: FillSnapshot, now: ReadonlyMap<number, ShapeRef>): FillSnapshot {
  if (!prev || prev.sessionId !== next.sessionId || prev.portal !== next.portal) return next;
  const resolved = resolveSnapshotIdx(prev, now);
  const idxs = new Set(next.items.flatMap((it) => it.group ?? [it.idx]));
  const keys = new Set(next.items.map((it) => it.key));
  const kept: SnapshotItem[] = [];
  for (const it of prev.items) {
    const at = resolved.get(it.idx);
    if (!at || idxs.has(at.idx) || keys.has(it.key)) continue;
    kept.push({ ...it, idx: at.idx, ...(it.group ? { group: [...at.idxs] } : {}) });
  }
  return { ...next, items: [...next.items, ...kept].slice(0, 120) };
}
