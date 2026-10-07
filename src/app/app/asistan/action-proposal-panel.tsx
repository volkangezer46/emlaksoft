"use client";

import { useState, useTransition } from "react";
import Link from "@/components/ui/smart-link";
import { Check, Sparkles, X } from "lucide-react";
import { approveAssistantAction, proposeAssistantAction } from "@/app/actions/assistant-actions";
import type { AssistantProposal } from "@/lib/ai/assistant-actions";
import { describeProposal } from "@/lib/ai/assistant-actions-view";
import { useToast } from "@/components/app/toast-provider";
import { CopyTextButton } from "@/components/app/copy-text-button";
import { Button } from "@/components/ui/button";
import { FormTextarea } from "@/components/ui/form-controls";

const EXAMPLES = [
  "Yarın Kadıköy alıcılarını aramak için görev oluştur",
  "Yeni satıcı adayı için 3 adımlı takip planı kur",
  "Kiracı müşterilerime yeni kiralık portföyler için kısa bir SMS taslağı hazırla",
];

/** Eylemli asistan: öneri → önizleme → kullanıcı onayı → kayıt. Onaysız hiçbir şey yazılmaz. */
export function ActionProposalPanel({ aiEnabled }: { aiEnabled: boolean }) {
  const [prompt, setPrompt] = useState("");
  const [proposal, setProposal] = useState<AssistantProposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [approving, startApprove] = useTransition();
  const { push } = useToast();

  return (
    <section aria-labelledby="eylem-asistani" className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      <h2 id="eylem-asistani" className="flex items-center gap-2 font-display text-sm font-bold text-ink-950">
        <Sparkles className="h-4 w-4 text-brand-600" aria-hidden /> Eylem öner (onaylı)
      </h2>
      <p className="mt-1 text-xs text-text-muted">
        Asistan görev, takip planı veya mesaj taslağı ÖNERİR; siz onaylamadan hiçbir kayıt oluşmaz ve hiçbir mesaj gönderilmez.
      </p>
      {!aiEnabled ? (
        <p className="mt-3 text-sm text-text-muted">AI anahtarı tanımlı olmadığı için eylem önerisi kapalı.</p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {EXAMPLES.map((e) => (
              <button key={e} type="button" onClick={() => setPrompt(e)} className="rounded-full border border-line bg-canvas px-2.5 py-1 text-xs text-text-muted transition hover:border-brand-400 hover:text-brand-600">
                {e}
              </button>
            ))}
          </div>
          <label htmlFor="eylem-istek" className="sr-only">Eylem isteği</label>
          <FormTextarea id="eylem-istek" className="mt-3" rows={2} maxLength={1000} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Ne yapılsın? (ör. Cuma günü Ayşe Hanım'ı aramak için görev)" />
          <div className="mt-2 flex items-center gap-2">
            <Button
              size="sm"
              icon={Sparkles}
              loading={pending}
              disabled={prompt.trim().length < 5}
              onClick={() =>
                start(async () => {
                  setError(null);
                  setDraft(null);
                  const res = await proposeAssistantAction(prompt);
                  if (res.error || !res.proposal) {
                    setProposal(null);
                    setError(res.error ?? "Öneri üretilemedi.");
                  } else setProposal(res.proposal);
                })
              }
            >
              Öneri al
            </Button>
            {error ? <p role="alert" className="text-xs text-danger-600">{error}</p> : null}
          </div>
          {proposal ? (
            <div className="mt-3 rounded-[var(--radius-card)] border border-brand-400/40 bg-brand-600/[0.04] p-3">
              <p className="text-xs font-semibold text-brand-700">Önizleme — onayınız bekleniyor</p>
              <ul className="mt-1 space-y-0.5 text-sm text-ink-950">
                {describeProposal(proposal).map((l, i) => (
                  <li key={i} className="whitespace-pre-line">{l}</li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  icon={Check}
                  loading={approving}
                  onClick={() =>
                    startApprove(async () => {
                      const res = await approveAssistantAction(proposal);
                      if (res.error) {
                        push(res.error, "err");
                        return;
                      }
                      if (res.draft) setDraft(res.draft);
                      else push(`${res.createdTasks ?? 0} görev oluşturuldu`);
                      setProposal(null);
                      setPrompt("");
                    })
                  }
                >
                  {proposal.type === "message_draft" ? "Taslağı onayla" : "Onayla ve oluştur"}
                </Button>
                <Button size="sm" variant="ghost" icon={X} onClick={() => setProposal(null)}>
                  Vazgeç
                </Button>
              </div>
            </div>
          ) : null}
          {draft ? (
            <div className="mt-3 rounded-[var(--radius-card)] border border-line bg-canvas p-3">
              <p className="whitespace-pre-line text-sm text-ink-950">{draft}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <CopyTextButton text={draft} label="Taslağı kopyala" />
                <Link href="/app/kampanyalar/yeni" className="text-xs font-semibold text-brand-600 hover:underline">
                  Kampanya olarak gönder →
                </Link>
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
