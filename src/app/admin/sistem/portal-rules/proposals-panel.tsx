"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import Link from "@/components/ui/smart-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormTextarea } from "@/components/ui/form-controls";
import { decideProposal } from "@/app/actions/admin-portal-rules";
import type { TransferPortal } from "@/lib/portal-transfer/rules";
import {
  CONFIDENCE_LABELS,
  CONFIDENCE_TONES,
  PROPOSAL_KIND_LABELS,
  PROPOSAL_STATE_LABELS,
  confidenceBucket,
  fieldLabel,
  formatConfidence,
  needsPiiAck,
  portalRulesHref,
  sourceBadge,
} from "@/lib/portal-rules/admin-model";

export type ProposalRow = {
  id: string;
  kind: string;
  fieldKey: string | null;
  proposal: unknown;
  source: string | null;
  aiUnverified: boolean;
  supportTenants: number;
  contradictTenants: number;
  supportSessions: number;
  weeksN: number;
  confidence: number;
  state: string;
  lastEvaluated: string | null;
};

export type EvidenceView = { proposalId: string; proposal: ProposalRow | null; data: unknown; unavailable: boolean };

/** Öneri içeriğinin kısa önizlemesi (etiket/seçenek/alan durumu). Kimlik/kiracı alanları gösterilmez. */
function preview(p: unknown): string | null {
  if (!p || typeof p !== "object") return null;
  const o = p as Record<string, unknown>;
  const parts: string[] = [];
  const push = (label: string, v: unknown) => {
    if (typeof v === "string" && v) parts.push(`${label}: ${v.slice(0, 60)}`);
    else if (Array.isArray(v) && v.length) parts.push(`${label}: ${v.filter((x) => typeof x === "string").slice(0, 4).join(", ")}`);
  };
  push("etiket", o.label ?? o.labels);
  push("seçenek", o.option ?? o.options);
  push("değer", o.value_key ?? o.target);
  push("durum", o.state);
  if (typeof o.anchor === "string") parts.push("alan imzası");
  return parts.length ? parts.join(" · ") : null;
}

const HIDDEN_EVIDENCE = /tenant|ofis_ad|name/i;

/** pt_rules_admin_evidence yanıtını biçimden bağımsız, kiracı alanlarını atarak gösterir. */
function EvidenceBody({ data }: { data: unknown }) {
  if (data == null) return <p className="text-sm text-text-muted">Kanıt kaydı yok.</p>;
  const root = typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : { satirlar: data };
  const scalars = Object.entries(root).filter(([k, v]) => !HIDDEN_EVIDENCE.test(k) && (typeof v === "number" || typeof v === "string" || typeof v === "boolean"));
  const lists = Object.entries(root).filter(([k, v]) => !HIDDEN_EVIDENCE.test(k) && Array.isArray(v)) as [string, unknown[]][];
  return (
    <div className="space-y-3">
      {scalars.length ? (
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          {scalars.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-xs text-text-muted">{k.replace(/_/g, " ")}</dt>
              <dd className="m-0 font-semibold tabular-nums text-ink-950">{typeof v === "boolean" ? (v ? "evet" : "hayır") : String(v)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {lists.map(([k, list]) => {
        const items = list.filter((x): x is Record<string, unknown> => !!x && typeof x === "object").slice(0, 40);
        const cols = [...new Set(items.flatMap((x) => Object.keys(x)))].filter((c) => !HIDDEN_EVIDENCE.test(c)).slice(0, 6);
        if (!items.length || !cols.length) return null;
        return (
          <div key={k} className="overflow-x-auto">
            <p className="text-xs font-semibold text-text-muted">{k.replace(/_/g, " ")}</p>
            <table className="mt-1 w-full min-w-[420px] text-left text-sm">
              <thead className="text-xs text-text-muted">
                <tr>{cols.map((c) => <th key={c} className="py-1 pr-3 font-semibold">{c.replace(/_/g, " ")}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-line">
                {items.map((x, i) => (
                  <tr key={i}>{cols.map((c) => <td key={c} className="py-1 pr-3 tabular-nums">{x[c] == null ? "—" : String(x[c])}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

function ProposalItem({ portal, p, canPublish, hasSet }: { portal: TransferPortal; p: ProposalRow; canPublish: boolean; hasSet: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"approve" | "reject" | null>(null);
  const [reason, setReason] = useState("");
  const [ack, setAck] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const src = sourceBadge(p.source, p.aiUnverified);
  const bucket = confidenceBucket(p.confidence);
  const evidenceHref = portalRulesHref(portal, `kanit:${p.id}`);
  const piiAck = needsPiiAck(p.kind, p.supportTenants);
  const pv = preview(p.proposal);

  const submit = () => {
    if (!mode) return;
    if (mode === "reject" && reason.trim().length < 3) {
      setMsg({ ok: false, text: "Reddetmek için gerekçe yazın (en az 3 karakter)." });
      return;
    }
    setMsg(null);
    start(async () => {
      const r = await decideProposal({ proposalId: p.id, decision: mode, reason: reason.trim(), noPersonalData: ack });
      setMsg({ ok: !!r.ok, text: r.ok ? (r.notice ?? "Kaydedildi.") : (r.error ?? "İşlem yapılamadı.") });
      if (r.ok) {
        setMode(null);
        setReason("");
        router.refresh();
      }
    });
  };

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-950">
            {p.fieldKey ? (
              <Link href={portalRulesHref(portal, `alan:${p.fieldKey}`)} className="hover:underline">
                {fieldLabel(p.fieldKey)}
              </Link>
            ) : (
              "Eşleşmemiş alan"
            )}
            <span className="font-normal text-text-muted">· {PROPOSAL_KIND_LABELS[p.kind] ?? p.kind}</span>
            <Badge variant={src.tone} size="sm">{src.label}</Badge>
            <Badge variant={p.state === "ready" ? "info" : "outline"} size="sm">{PROPOSAL_STATE_LABELS[p.state] ?? p.state}</Badge>
          </p>
          {pv ? <p className="mt-0.5 truncate text-xs text-text-muted">{pv}</p> : null}
          <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-text-muted">
            <Link href={evidenceHref} className="hover:underline">
              <span className="font-semibold tabular-nums text-ink-950">{p.supportTenants}</span> ofis destek
            </Link>
            <Link href={evidenceHref} className="hover:underline">
              <span className="font-semibold tabular-nums text-ink-950">{p.contradictTenants}</span> karşı
            </Link>
            <Link href={evidenceHref} className="hover:underline">
              <span className="font-semibold tabular-nums text-ink-950">{p.supportSessions}</span> oturum
            </Link>
            <Link href={evidenceHref} className="hover:underline">
              <span className="font-semibold tabular-nums text-ink-950">{p.weeksN}</span> hafta
            </Link>
            <Link href={evidenceHref} className="hover:underline">
              güven <span className="font-semibold tabular-nums text-ink-950">{formatConfidence(p.confidence)}</span>{" "}
              <Badge variant={CONFIDENCE_TONES[bucket]} size="sm">{CONFIDENCE_LABELS[bucket]}</Badge>
            </Link>
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            size="xs"
            variant="outline"
            icon={Check}
            disabled={!canPublish || !hasSet || pending}
            title={!canPublish ? "Yayın yalnız süper admin" : !hasSet ? "Önce tohumu yayınlayın" : undefined}
            onClick={() => setMode(mode === "approve" ? null : "approve")}
          >
            Onayla
          </Button>
          <Button size="xs" variant="outline" icon={X} disabled={pending} onClick={() => setMode(mode === "reject" ? null : "reject")}>
            Reddet
          </Button>
        </div>
      </div>
      {mode ? (
        <div className="mt-3 space-y-2 rounded-[var(--radius-card)] border border-line bg-canvas p-3">
          <label className="block text-xs font-semibold text-text-muted" htmlFor={`reason-${p.id}`}>
            {mode === "reject" ? "Ret gerekçesi (zorunlu)" : "Onay notu (isteğe bağlı)"}
          </label>
          <FormTextarea id={`reason-${p.id}`} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          {mode === "approve" && piiAck ? (
            <label className="flex items-start gap-2 text-xs text-ink-950">
              <input type="checkbox" className="mt-0.5" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              Bu öneri tek ofisten geliyor. Metnin kişisel veri (ad, telefon, ofis adı) içermediğini kontrol ettim.
            </label>
          ) : null}
          <div className="flex gap-2">
            <Button size="xs" variant={mode === "reject" ? "danger" : "primary"} loading={pending} disabled={mode === "approve" && piiAck && !ack} onClick={submit}>
              {mode === "reject" ? "Reddet" : "Onayla ve yeni sürüm yayınla"}
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setMode(null)}>
              Vazgeç
            </Button>
          </div>
        </div>
      ) : null}
      {msg ? (
        <p role={msg.ok ? "status" : "alert"} className={`mt-2 text-xs font-semibold ${msg.ok ? "text-mint-700" : "text-danger-600"}`}>
          {msg.text}
        </p>
      ) : null}
    </li>
  );
}

/** Bekleyen öneriler (ready/collecting). Kanıt: ofis/oturum/hafta sayıları; kiracı adı yok. */
export function ProposalsPanel({
  portal,
  proposals,
  readyCount,
  canPublish,
  hasSet,
  evidence,
  aiSlot,
}: {
  portal: TransferPortal;
  proposals: ProposalRow[];
  readyCount: number;
  canPublish: boolean;
  hasSet: boolean;
  evidence: EvidenceView | null;
  aiSlot?: ReactNode;
}) {
  return (
    <section aria-label="Bekleyen öneriler" className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display font-bold text-ink-950">Bekleyen öneriler</h2>
          <p className="mt-1 text-sm text-text-muted">
            <Link href={portalRulesHref(portal, "oneriler")} className="font-semibold text-ink-950 hover:underline">
              {readyCount} onay bekliyor
            </Link>
            . Onay, yayındaki sete öneriyi uygular, doğrular ve yeni sürüm yayınlar. AI önerileri kendiliğinden onaylanmaz.
          </p>
        </div>
        {aiSlot}
      </div>
      {evidence ? (
        <div className="mt-4 rounded-[var(--radius-card)] border border-line bg-canvas p-4">
          <p className="text-xs font-semibold text-text-muted">Kanıt (ofis adı gösterilmez)</p>
          <div className="mt-2">
            {evidence.unavailable ? <p className="text-sm text-text-muted">Kanıt şu an okunamadı.</p> : <EvidenceBody data={evidence.data} />}
          </div>
        </div>
      ) : null}
      {proposals.length === 0 ? (
        <p className="mt-4 text-sm text-text-muted">
          {evidence ? "Bu öneri artık karar beklemiyor." : "Karar bekleyen öneri yok. Öneriler, ofislerin düzeltmelerinden gece öğrenme adımıyla üretilir."}
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {proposals.map((p) => (
            <ProposalItem key={p.id} portal={portal} p={p} canPublish={canPublish} hasSet={hasSet} />
          ))}
        </ul>
      )}
    </section>
  );
}
