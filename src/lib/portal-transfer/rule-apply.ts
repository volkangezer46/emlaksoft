import { FIELD_RULES, FILL_FIELD_KEYS, fold, type FillControl, type FillFieldKey } from "./rules";
import { RISKY_FIELD_KEYS, validateRuleSet, type RuleField, type RuleSet } from "./rule-format";

/**
 * ÖNERİLERDEN YENİ KURAL SETİ (SAF, testli). Yeni sürüm TEK yerden üretilir: hem öğrenme cron'u hem yönetim onayı bunu
 * kullanır, sonuç eklentiyle aynı `validateRuleSet`'ten geçer — bozuk bir set yayına giremez.
 *
 * Kurallar:
 *  - label_map: etiket ya da çapa EKLER (silmez).
 *  - option_map: seçenek takma adı EKLER.
 *  - field_demote: alan `degraded` (disabled ise dokunulmaz).
 *  - field_disable: alan `disabled` — YALNIZ personel (`source: "staff"`) önerisiyle.
 *  - new_field: alan yoksa `unverified` olarak eklenir; varsa etiketleri eklenir.
 *  - form_meta: form sayısal parametreleri / zorunlu-önerilen listeleri.
 *  - Ofis oylarından (corrections/unmatched) gelen eşleme alanı `verified` yapar; AI önerisi alanı en çok `unverified`
 *    bırakır (AI kendi başına doğrulamaz). Doğrulanmış alanın etiket/seçeneklerinden SİLME yoktur.
 *  - En çok `maxChanges` öneri (varsayılan 5); fazlası reddedilir.
 */

export const PROPOSAL_KINDS = ["label_map", "option_map", "field_demote", "field_disable", "new_field", "form_meta"] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];
export const PROPOSAL_SOURCES = ["corrections", "unmatched", "ai", "staff"] as const;
export type ProposalSource = (typeof PROPOSAL_SOURCES)[number];

export type RuleProposal = {
  id?: string;
  kind: ProposalKind;
  field_key: FillFieldKey | null;
  source: ProposalSource;
  /** Kind'e göre: label_map {label?, anchor?}; option_map {value, alias}; new_field {control, labels, exact?, anchors?}; form_meta {...}. */
  proposal: Record<string, unknown>;
  confidence?: number | null;
};

export type RuleChange = { proposalId: string | null; kind: ProposalKind; key: FillFieldKey | null; detail: string };
export type ChangeSummary = { changes: RuleChange[]; count: number };

export type ApplyResult = { ok: true; content: RuleSet; changeSummary: ChangeSummary } | { ok: false; reason: string; proposalId?: string | null };

export type ApplyOptions = {
  maxChanges?: number;
  /** Verilirse sonuç bu sürüm/zaman damgalarıyla üretilir (yayın). */
  stamp?: { version: number; issuedAt: string; expiresAt: string; minExtension?: string };
};

const ANCHOR_RE = /^[0-9a-f]{16}$/;
const SEED_CONTROL = new Map<FillFieldKey, FillControl>(FIELD_RULES.map((r) => [r.key, r.control]));

function clone(set: RuleSet): RuleSet {
  return JSON.parse(JSON.stringify(set)) as RuleSet;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** Önceki setten sonraki sete geçişte doğrulanmış alanlardan silinen etiket/tam ifade/çapa/seçenek takma adları. */
export function verifiedRemovals(prev: RuleSet, next: RuleSet): string[] {
  const out: string[] = [];
  const nextBy = new Map(next.fields.map((f) => [f.key, f]));
  for (const f of prev.fields) {
    if (f.state !== "verified") continue;
    const n = nextBy.get(f.key);
    if (!n) {
      out.push(`${f.key}:alan`);
      continue;
    }
    for (const l of f.labels) if (!n.labels.includes(l)) out.push(`${f.key}:etiket:${l}`);
    for (const l of f.exact) if (!n.exact.includes(l)) out.push(`${f.key}:tam:${l}`);
    for (const a of f.anchors) if (!n.anchors.includes(a)) out.push(`${f.key}:capa:${a}`);
    for (const [k, aliases] of Object.entries(f.options)) {
      for (const a of aliases) if (!(n.options[k] ?? []).includes(a)) out.push(`${f.key}:secenek:${k}:${a}`);
    }
  }
  return out;
}

function promote(field: RuleField, source: ProposalSource, confidence: number | null | undefined): void {
  if (field.state === "disabled" || field.state === "degraded") return;
  if (source === "ai") {
    // AI önerisi kendi başına doğrulamaz: onaylanan AI eşlemesi alanı "öneri (doğrulanmamış)" yapar.
    field.state = "unverified";
    return;
  }
  if (source === "corrections" || source === "unmatched") {
    field.state = "verified";
    if (typeof confidence === "number" && Number.isFinite(confidence)) field.confidence = Math.max(0, Math.min(1, Math.round(confidence * 1000) / 1000));
  }
}

export function applyProposals(content: RuleSet, proposals: readonly RuleProposal[], opts: ApplyOptions = {}): ApplyResult {
  const maxChanges = opts.maxChanges ?? 5;
  if (proposals.length === 0) return { ok: false, reason: "no_proposals" };
  if (proposals.length > maxChanges) return { ok: false, reason: "too_many_changes" };
  const base = validateRuleSet(content, { allowSeed: true });
  if (!base.ok) return { ok: false, reason: `base_invalid:${base.reason}` };
  const next = clone(base.set);
  const changes: RuleChange[] = [];

  for (const p of proposals) {
    const pid = p.id ?? null;
    const fail = (reason: string): ApplyResult => ({ ok: false, reason, proposalId: pid });
    if (!(PROPOSAL_KINDS as readonly string[]).includes(p.kind) || !(PROPOSAL_SOURCES as readonly string[]).includes(p.source)) return fail("proposal_shape");
    if (p.kind !== "form_meta" && (!p.field_key || !(FILL_FIELD_KEYS as readonly string[]).includes(p.field_key))) return fail("proposal_key");
    const key = p.field_key as FillFieldKey;
    const field = p.kind === "form_meta" ? null : next.fields.find((f) => f.key === key) ?? null;
    if (p.kind !== "form_meta" && p.kind !== "new_field" && !field) return fail("field_missing");
    if ((p.kind === "label_map" || p.kind === "option_map" || p.kind === "new_field") && RISKY_FIELD_KEYS.includes(key) && p.source !== "staff") {
      return fail("risky_key");
    }

    switch (p.kind) {
      case "label_map": {
        const label = str(p.proposal.label);
        const anchor = str(p.proposal.anchor);
        if (!label && !anchor) return fail("label_map_empty");
        const parts: string[] = [];
        if (label) {
          if (fold(label) !== label) return fail("label_not_folded");
          if (!field!.labels.includes(label)) {
            field!.labels.push(label);
            parts.push(`etiket "${label}"`);
          }
        }
        if (anchor) {
          if (!ANCHOR_RE.test(anchor)) return fail("anchor_format");
          if (!field!.anchors.includes(anchor)) {
            field!.anchors.push(anchor);
            parts.push(`çapa ${anchor}`);
          }
        }
        promote(field!, p.source, p.confidence);
        changes.push({ proposalId: pid, kind: p.kind, key, detail: parts.length ? `${parts.join(", ")} eklendi` : "zaten vardı" });
        break;
      }
      case "option_map": {
        const value = str(p.proposal.value);
        const alias = str(p.proposal.alias);
        if (!value || !alias || fold(value) !== value || fold(alias) !== alias) return fail("option_map_shape");
        const list = (field!.options[value] ??= []);
        if (!list.includes(alias)) list.push(alias);
        promote(field!, p.source, p.confidence);
        changes.push({ proposalId: pid, kind: p.kind, key, detail: `seçenek "${value}" → "${alias}"` });
        break;
      }
      case "field_demote": {
        if (field!.state !== "disabled") field!.state = "degraded";
        changes.push({ proposalId: pid, kind: p.kind, key, detail: "kontrol edin (degraded)" });
        break;
      }
      case "field_disable": {
        if (p.source !== "staff") return fail("disable_requires_staff");
        field!.state = "disabled";
        changes.push({ proposalId: pid, kind: p.kind, key, detail: "elle doldurun (disabled)" });
        break;
      }
      case "new_field": {
        const labels = Array.isArray(p.proposal.labels) ? p.proposal.labels.filter((x): x is string => typeof x === "string") : [];
        const exact = Array.isArray(p.proposal.exact) ? p.proposal.exact.filter((x): x is string => typeof x === "string") : [];
        const anchors = Array.isArray(p.proposal.anchors) ? p.proposal.anchors.filter((x): x is string => typeof x === "string") : [];
        if (field) {
          for (const l of labels) if (!field.labels.includes(l)) field.labels.push(l);
          for (const l of exact) if (!field.exact.includes(l)) field.exact.push(l);
          for (const a of anchors) if (!field.anchors.includes(a)) field.anchors.push(a);
          if (field.state === "verified" && p.source === "ai") field.state = "unverified";
          changes.push({ proposalId: pid, kind: p.kind, key, detail: "mevcut alana ifade eklendi" });
        } else {
          const control = str(p.proposal.control) ?? SEED_CONTROL.get(key) ?? "text";
          next.fields.push({ key, control: control as FillControl, labels, exact, anchors, options: {}, state: "unverified", confidence: 0 });
          changes.push({ proposalId: pid, kind: p.kind, key, detail: "yeni alan (doğrulanmamış)" });
        }
        break;
      }
      case "form_meta": {
        const f = p.proposal;
        if (typeof f.maxPhotos === "number") next.form.maxPhotos = f.maxPhotos;
        if (typeof f.titleMax === "number") next.form.titleMax = f.titleMax;
        if (Array.isArray(f.required)) next.form.required = f.required as FillFieldKey[];
        if (f.recommended && typeof f.recommended === "object") next.form.recommended = { ...next.form.recommended, ...(f.recommended as Partial<RuleSet["form"]["recommended"]>) };
        if (Array.isArray(f.fingerprints)) next.fingerprints = f.fingerprints as string[];
        changes.push({ proposalId: pid, kind: p.kind, key: null, detail: "form parametreleri" });
        break;
      }
    }
  }

  if (opts.stamp) {
    next.version = opts.stamp.version;
    next.issuedAt = opts.stamp.issuedAt;
    next.expiresAt = opts.stamp.expiresAt;
    if (opts.stamp.minExtension) next.minExtension = opts.stamp.minExtension;
  }
  const removed = verifiedRemovals(base.set, next);
  if (removed.length > 0) return { ok: false, reason: `verified_removal:${removed[0]}` };
  const checked = validateRuleSet(next, { allowSeed: next.version === 0 });
  if (!checked.ok) return { ok: false, reason: `invalid_result:${checked.reason}` };
  return { ok: true, content: checked.set, changeSummary: { changes, count: changes.length } };
}

/** Yayın damgası: sürüm, şimdi ve ömür (gün). Saf: zaman çağırandan gelir. */
export function stampFor(version: number, nowMs: number, ttlDays: number): { version: number; issuedAt: string; expiresAt: string } {
  const iso = (ms: number) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(/\.000Z$/, "Z");
  return { version, issuedAt: iso(nowMs), expiresAt: iso(nowMs + ttlDays * 86_400_000) };
}

/** Bir seti (içerik aynı) yeni sürüm/zamanla yeniden damgalar: geri alma ve süre tazeleme. */
export function restamp(set: RuleSet, stamp: { version: number; issuedAt: string; expiresAt: string; minExtension?: string }): RuleSet {
  const next = clone(set);
  next.version = stamp.version;
  next.issuedAt = stamp.issuedAt;
  next.expiresAt = stamp.expiresAt;
  if (stamp.minExtension) next.minExtension = stamp.minExtension;
  return next;
}
