"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eraser, Info, ShieldCheck, Trash2 } from "lucide-react";
import { Combobox } from "@/components/ui/combobox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";
import { purgeStaleCustomers, requestCustomerErasure } from "@/app/actions/kvkk";
import { searchCustomers } from "@/app/actions/lookup";
import type { ComboboxOption } from "@/components/ui/combobox";

type LogRow = {
  id: string;
  customer_ref: string;
  reason: string | null;
  affected: Record<string, number> | null;
  performed_at: string;
};

function tarih(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

/**
 * KVKK silme talebi paneli (X5).
 *
 * NEDEN "SİLME" DEĞİL "ANONİMLEŞTİRME": Gerçek silme şemada mümkün değil —
 * `deals` ve `calls` yabancı anahtarları kısıtlayıcı ve ticari kayıtlar TTK
 * gereği saklanmak zorunda. Panel bunu kullanıcıya AÇIKÇA söylüyor; "sildim"
 * sanıp KVKK yükümlülüğünü yerine getirdiğini düşünmesi en kötü sonuç olurdu.
 *
 * GERİ ALINAMAZ: Onay adımı var ve düğme metni ne olacağını birebir yazıyor.
 */
export function KvkkPanel({ initialLog, canErase }: { initialLog: LogRow[]; canErase: boolean }) {
  const router = useRouter();
  const [acik, setAcik] = useState(false);
  const [musteriId, setMusteriId] = useState("");
  const [neden, setNeden] = useState("");
  const [hata, setHata] = useState<string | null>(null);
  const [sonuc, setSonuc] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [temizlikSonuc, setTemizlikSonuc] = useState<string | null>(null);

  function anonimlestir() {
    setHata(null);
    setSonuc(null);
    if (!musteriId) {
      setHata("Müşteri seçin.");
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set("customer_id", musteriId);
      fd.set("reason", neden);
      const r = await requestCustomerErasure(fd);
      if (r.error) {
        setHata(r.error);
        return;
      }
      setSonuc(r.ref ?? "Kayıt anonimleştirildi.");
      setMusteriId("");
      setNeden("");
      setAcik(false);
      router.refresh();
    });
  }

  function temizle() {
    setTemizlikSonuc(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("days", "1095");
      const r = await purgeStaleCustomers(fd);
      setTemizlikSonuc(
        r.error ?? `${r.count ?? 0} kayıt anonimleştirildi (3 yıldan eski silinmiş müşteriler).`,
      );
      router.refresh();
    });
  }

  return (
    <section className="surface-card rounded-[var(--radius-panel)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
            <ShieldCheck className="h-4 w-4" /> KVKK yaşam döngüsü
          </p>
          <h2 className="mt-1 font-display font-bold text-ink-950">Silme talebi ve saklama</h2>
        </div>

        {canErase ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={temizle}
              disabled={pending}
              className="focus-ring press inline-flex items-center gap-1.5 rounded-[10px] border border-hairline px-3 py-2 text-xs font-semibold text-text-muted transition hover:border-amber-400 hover:text-amber-600 disabled:opacity-60"
            >
              <Trash2 className="h-3.5 w-3.5" /> Saklama süresi dolanları temizle
            </button>

            <Dialog open={acik} onOpenChange={setAcik}>
              <DialogTrigger asChild>
                <button
                  type="button"
                  className="btn-shine focus-ring press inline-flex items-center gap-2 rounded-[10px] bg-danger-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-danger-700"
                >
                  <Eraser className="h-3.5 w-3.5" /> Silme talebi işle
                </button>
              </DialogTrigger>

              <DialogContent size="sm">
                <DialogHeader
                  tone="danger"
                  icon={<Eraser />}
                  title="KVKK silme talebi"
                  description="Bu işlem geri alınamaz."
                />
                <div className="grid gap-4 p-6">
                  <div>
                    <span className="mb-1.5 block text-sm text-text-muted">Müşteri *</span>
                    <Combobox
                      name="_musteri"
                      required
                      aria-label="Müşteri"
                      value={musteriId}
                      onValueChange={setMusteriId}
                      options={[] as ComboboxOption[]}
                      onSearch={searchCustomers}
                      placeholder="Müşteri ara ve seçin"
                      searchPlaceholder="Ad ya da telefon…"
                      emptyText="Eşleşen müşteri yok"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm text-text-muted" htmlFor="kvkk-neden">
                      Talep gerekçesi
                    </label>
                    <input
                      id="kvkk-neden"
                      value={neden}
                      onChange={(e) => setNeden(e.target.value)}
                      className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400"
                      placeholder="Örn. müşterinin yazılı silme talebi · 12.07.2026"
                    />
                    <p className="mt-1.5 text-[11px] text-text-faint">
                      Denetimde bu gerekçe sorulur. Talebin tarihini ve geldiği kanalı yazın.
                    </p>
                  </div>

                  {/* Kullanicinin "sildim" sanmasi en kotu sonuc olurdu. */}
                  <div className="rounded-[12px] border border-amber-400/35 bg-amber-400/[0.07] px-4 py-3">
                    <p className="text-xs font-semibold text-ink-950">Ne olacak?</p>
                    <ul className="mt-1.5 space-y-1 text-[11px] leading-relaxed text-text-muted">
                      <li>· Ad, telefon, e-posta, not, doğum tarihi <strong>maskelenir</strong></li>
                      <li>· Kampanya ve açık ev kayıtlarındaki <strong>kopyalar</strong> da temizlenir</li>
                      <li>· Görüşme metinleri ve çağrı numarası silinir</li>
                      <li>· İYS izinleri geri çekilir, portal erişimi iptal edilir</li>
                      <li>· <strong>Kayıt satırı silinmez:</strong> anlaşma ve komisyon kayıtları TTK gereği saklanmak zorunda</li>
                      <li>· Denetim için <strong>maskeli bir kanıt kaydı</strong> oluşur</li>
                    </ul>
                  </div>

                  {hata ? (
                    <p className="text-sm font-medium text-danger-600" role="alert">
                      {hata}
                    </p>
                  ) : null}

                  <div className="hairline-t flex justify-end gap-2 pt-4">
                    <DialogClose asChild>
                      <button
                        type="button"
                        className="focus-ring press rounded-[10px] border border-hairline px-4 py-2.5 text-sm font-medium text-ink-950 transition hover:bg-canvas"
                      >
                        Vazgeç
                      </button>
                    </DialogClose>
                    <button
                      type="button"
                      onClick={anonimlestir}
                      disabled={pending}
                      className="btn-shine focus-ring press rounded-[10px] bg-danger-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-danger-700 disabled:opacity-60"
                    >
                      {pending ? "İşleniyor…" : "Anonimleştir (geri alınamaz)"}
                    </button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        ) : null}
      </div>

      {sonuc ? (
        <p className="mt-3 rounded-[12px] border border-mint-500/30 bg-mint-500/[0.06] px-4 py-2.5 text-sm text-mint-600" role="status">
          Anonimleştirildi · kanıt referansı <strong className="numeric">{sonuc}</strong>
        </p>
      ) : null}
      {temizlikSonuc ? (
        <p className="mt-3 rounded-[12px] border border-line bg-canvas px-4 py-2.5 text-sm text-ink-950" role="status">
          {temizlikSonuc}
        </p>
      ) : null}

      {/* Silme kaniti — denetimde gosterilecek olan */}
      <div className="mt-4">
        <h3 className="text-sm font-bold text-ink-950">Silme kanıtı</h3>
        {initialLog.length === 0 ? (
          <p className="mt-2 rounded-[12px] border border-dashed border-line-strong px-4 py-6 text-center text-sm text-text-muted">
            Henüz işlenmiş silme talebi yok.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {initialLog.map((r) => (
              <li key={r.id} className="rounded-[12px] border border-line bg-canvas px-4 py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className="numeric text-sm font-semibold text-ink-950">{r.customer_ref}</p>
                  <time className="numeric text-[11px] text-text-faint" dateTime={r.performed_at}>
                    {tarih(r.performed_at)}
                  </time>
                </div>
                {r.reason ? <p className="mt-0.5 text-xs text-text-muted">{r.reason}</p> : null}
                {r.affected && Object.keys(r.affected).length > 0 ? (
                  <p className="mt-1 flex flex-wrap gap-1.5">
                    {Object.entries(r.affected).map(([tablo, adet]) => (
                      <span
                        key={tablo}
                        className="numeric rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold text-text-muted"
                      >
                        {tablo} {adet}
                      </span>
                    ))}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="mt-4 flex items-start gap-2 text-[11px] leading-relaxed text-text-faint">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" />
        <span>
          Kayıt <strong>silinmez, anonimleştirilir</strong>. Gerçek silme şemada mümkün değil: anlaşma
          ve çağrı kayıtlarının yabancı anahtarları kısıtlayıcı ve ticari kayıtlar saklanmak zorunda.
          Anonimleştirme kişiyi işaret eden tüm alanları — denormalize kopyalar dahil — maskeler.
          Saklama süresi varsayılanı <strong>3 yıl</strong>; bu bir öneri, mevzuat hükmü değil —
          kendi hukuk görüşünüze göre ayarlayın.
        </span>
      </p>
    </section>
  );
}
