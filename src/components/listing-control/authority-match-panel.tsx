"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link2, Search } from "lucide-react";
import Link from "@/components/ui/smart-link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FormError, FormField, FormInput, FormSelect } from "@/components/ui/form-controls";
import { useToast } from "@/components/app/toast-provider";
import {
  applyAuthorityMatch,
  findAuthorityMatchAction,
  type AuthorityMatchActionResult,
  type AuthorityMatchInput,
} from "@/app/actions/authority-queue";

/**
 * "Eşleştir" sekmesi (istemci): Bakanlık EİDS bildirimindeki bilgilerle portföy bulma. Taşınmaz no birebir tutarsa tek
 * portföy önerilir; tutmazsa en çok 5 aday (malik adı benzerliği + EİDS no boşluğu) gösterilir. HİÇBİR ŞEY KENDİLİĞİNDEN
 * BAĞLANMAZ: kullanıcı "Uygula" ya da "Bağla ve uygula" der; bağlayan kişi portföye taşınmaz no'yu yazmış olur.
 * Malik adı ekranda maskelidir. Prefill: EP3 kuyruğundaki bildirimden gelen değerler.
 */
export function AuthorityMatchPanel({ canEdit, prefill }: { canEdit: boolean; prefill?: Partial<AuthorityMatchInput> }) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, start] = useTransition();
  const [form, setForm] = useState<AuthorityMatchInput>({
    propertyNo: prefill?.propertyNo ?? "",
    dealKind: prefill?.dealKind ?? "",
    grantorName: prefill?.grantorName ?? "",
    validUntil: prefill?.validUntil ?? "",
    kind: prefill?.kind ?? "grant",
  });
  const [result, setResult] = useState<AuthorityMatchActionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof AuthorityMatchInput) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const search = () => {
    setError(null);
    start(async () => {
      const r = await findAuthorityMatchAction(form);
      if (!r.ok) {
        setResult(null);
        setError(r.error);
        return;
      }
      setResult(r);
    });
  };

  const apply = (propertyId: string, bind: boolean) => {
    setError(null);
    start(async () => {
      const r = await applyAuthorityMatch(propertyId, form, bind);
      if (r.error) {
        setError(r.error);
        return;
      }
      if (r.info) push(r.info, "ok");
      setResult(null);
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <form
        className="grid gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-5"
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
      >
        <FormField label="Bildirim" htmlFor="em-kind">
          <FormSelect id="em-kind" value={form.kind ?? "grant"} onChange={set("kind")}>
            <option value="grant">Yetki verildi</option>
            <option value="revoke">Yetki iptal edildi</option>
          </FormSelect>
        </FormField>
        <FormField label="Taşınmaz no" htmlFor="em-no" required hint="Yalnız rakamlar dikkate alınır.">
          <FormInput id="em-no" value={form.propertyNo} onChange={set("propertyNo")} inputMode="numeric" autoComplete="off" maxLength={40} placeholder="Örn. 123456789" />
        </FormField>
        <FormField label="Satış / kiralama" htmlFor="em-deal">
          <FormSelect id="em-deal" value={form.dealKind ?? ""} onChange={set("dealKind")}>
            <option value="">Bilinmiyor</option>
            <option value="sale">Satış</option>
            <option value="rent">Kiralama</option>
          </FormSelect>
        </FormField>
        <FormField label="Yetkiyi veren (malik)" htmlFor="em-name" hint="Aday aramada kullanılır; saklanmaz.">
          <FormInput id="em-name" value={form.grantorName ?? ""} onChange={set("grantorName")} autoComplete="off" maxLength={120} />
        </FormField>
        <FormField label="Bitiş tarihi" htmlFor="em-until" hint="E-postadaki 'tarihine kadar'.">
          <FormInput id="em-until" type="date" value={form.validUntil ?? ""} onChange={set("validUntil")} />
        </FormField>
        <div className="sm:col-span-2 lg:col-span-5">
          <Button type="submit" icon={Search} loading={pending} disabled={!form.propertyNo.trim()}>
            Portföy bul
          </Button>
        </div>
      </form>

      <FormError error={error} />

      {result?.ok ? (
        <section className="space-y-3" aria-live="polite">
          {result.exact ? (
            <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
              <p className="text-sm font-semibold text-ink-950">Birebir eşleşme</p>
              <Link href={`/app/portfoyler/${result.exact.id}?sekme=belgeler`} className="focus-ring mt-1 inline-block rounded text-sm font-semibold text-accent-text hover:underline">
                <span className="font-mono text-xs text-text-muted">{result.exact.property_code ?? "-"}</span> {result.exact.title ?? "Portföy"}
              </Link>
              {result.exact.warnings.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {result.exact.warnings.map((w) => (
                    <li key={w} className="text-xs text-text-muted">• {w}</li>
                  ))}
                </ul>
              ) : null}
              {canEdit ? (
                <div className="mt-3">
                  <Button size="sm" loading={pending} onClick={() => apply(result.exact!.id, false)}>
                    {form.kind === "revoke" ? "İptali uygula" : "Yetkiyi uygula"}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {result.match.ambiguous.length > 0 ? (
            <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
              <p className="text-sm font-semibold text-ink-950">Bu numara birden çok portföyde kayıtlı</p>
              <p className="mt-0.5 text-xs text-text-muted">Satış/kiralama bilgisiyle ayırt edilemedi; doğru portföyü siz seçin.</p>
              <ul className="mt-2 space-y-2">
                {result.match.ambiguous.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/app/portfoyler/${a.id}?sekme=belgeler`} className="focus-ring rounded text-sm font-semibold text-accent-text hover:underline">
                      <span className="font-mono text-xs text-text-muted">{a.property_code ?? "-"}</span> {a.title ?? "Portföy"}
                      {a.transaction_type ? <span className="ml-1 text-xs font-normal text-text-muted">({a.transaction_type})</span> : null}
                    </Link>
                    {canEdit ? (
                      <Button size="sm" variant="secondary" disabled={pending} onClick={() => apply(a.id, false)}>
                        Bu portföye uygula
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {!result.exact ? (
            result.match.candidates.length > 0 ? (
              <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
                <p className="text-sm font-semibold text-ink-950">Aday portföyler (en çok 5)</p>
                <p className="mt-0.5 text-xs text-text-muted">Taşınmaz no hiçbir portföyle birebir tutmadı. Adaylar otomatik bağlanmaz; doğruysa seçip bağlayın.</p>
                <ul className="mt-2 divide-y divide-line">
                  {result.match.candidates.map((c) => (
                    <li key={c.propertyId} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <Link href={`/app/portfoyler/${c.propertyId}?sekme=belgeler`} className="focus-ring block truncate rounded text-sm font-semibold text-accent-text hover:underline">
                          <span className="font-mono text-xs text-text-muted">{c.property_code ?? "-"}</span> {c.title ?? "Portföy"}
                        </Link>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <Badge size="sm" variant="info">Puan {c.score}</Badge>
                          {c.owner_masked ? <Badge size="sm" variant="outline">Malik: {c.owner_masked}</Badge> : null}
                          {c.reasons.map((r) => (
                            <span key={r} className="text-xs text-text-muted">{r}</span>
                          ))}
                        </div>
                      </div>
                      {canEdit ? (
                        <Button size="sm" variant="secondary" icon={Link2} disabled={pending || Boolean(c.eids_property_no)} title={c.eids_property_no ? "Bu portföyde başka bir taşınmaz no kayıtlı" : undefined} onClick={() => apply(c.propertyId, true)}>
                          Bağla ve uygula
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : result.match.ambiguous.length === 0 ? (
              <p className="rounded-[var(--radius-card)] border border-dashed border-line p-4 text-sm text-text-muted">
                Ne oldu: bu taşınmaz no ve malik adıyla ofiste portföy bulunamadı. Ne yapmalı: numarayı kontrol edin; portföy henüz açılmadıysa önce portföyü
                oluşturup taşınmaz no alanına bu numarayı girin.
              </p>
            ) : null
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
