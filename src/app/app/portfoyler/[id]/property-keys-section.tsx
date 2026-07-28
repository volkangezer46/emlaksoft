"use client";

import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  History,
  KeyRound,
  LogOut,
  Plus,
  Trash2,
  Undo2,
  UserRound,
} from "lucide-react";
import {
  addPropertyKey,
  checkoutPropertyKey,
  deletePropertyKey,
  reportPropertyKeyLost,
  returnPropertyKey,
  type KeyResult,
  type PropertyKeyEvent,
  type PropertyKeyRow,
} from "@/app/actions/property-keys";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/app/toast-provider";
import {
  isKeyOut,
  keyHolderLabel,
  keyOverdueDays,
  keyStatusLabel,
  keyStatusTone,
} from "@/lib/key-overdue";

/**
 * Anahtar takibi — portföyün fiziksel anahtarları kimde?
 *
 * Ofisin klasik kayıp kaynağı: anahtar danışmandan müşteriye, müşteriden
 * ofise elden dolaşıyor ve kaydı hiçbir yerde tutulmuyor. Bölüm üç soruyu
 * cevaplar: kaç anahtar var, şu an kimde, ne zaman geri gelecek.
 *
 * ZAMAN: `nowMs` PROP olarak gelir (sunucu render anı) — bileşen gövdesinde
 * `Date.now()` çağrılmaz (src/lib/clock.ts kuralı).
 */

export type KeyWithHolder = PropertyKeyRow & { holder_staff_name: string | null };

const dtf = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" });
const dtfLong = new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short" });

function shortDate(value: string | null) {
  if (!value) return "—";
  return dtf.format(new Date(value));
}

const EVENT_LABEL: Record<string, string> = {
  olusturma: "Anahtar eklendi",
  cikis: "Çıkış verildi",
  iade: "İade alındı",
  kayip: "Kayıp bildirildi",
  not: "Not",
};

export function PropertyKeysSection({
  propertyId,
  keys,
  events,
  staff,
  defaultDueDate,
  nowMs,
  canEdit,
  canDelete,
}: {
  propertyId: string;
  keys: KeyWithHolder[];
  events: Record<string, PropertyKeyEvent[]>;
  staff: { id: string; full_name: string | null }[];
  /** "+2 gün" varsayılan vade (yyyy-aa-gg) — sunucuda hesaplanır. */
  defaultDueDate: string;
  /** Sunucu render anı (epoch ms) — gecikme hesabı için. */
  nowMs: number;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [adding, setAdding] = useState(false);
  const [checkoutFor, setCheckoutFor] = useState<string | null>(null);
  const [holderType, setHolderType] = useState<"staff" | "customer">("staff");
  const addFormRef = useRef<HTMLFormElement>(null);

  const [addState, addAction, addPending] = useActionState<KeyResult, FormData>(
    async (prev, fd) => {
      const result = await addPropertyKey(prev, fd);
      if (result.ok) {
        addFormRef.current?.reset();
        setAdding(false);
        push("Anahtar eklendi", "ok");
        router.refresh();
      }
      return result;
    },
    {},
  );

  const [outState, outAction, outPending] = useActionState<KeyResult, FormData>(
    async (prev, fd) => {
      const result = await checkoutPropertyKey(prev, fd);
      if (result.ok) {
        setCheckoutFor(null);
        push("Anahtar çıkışı kaydedildi", "ok");
        router.refresh();
      }
      return result;
    },
    {},
  );

  const outside = keys.filter((k) => isKeyOut(k.status)).length;
  const overdue = keys.filter((k) => keyOverdueDays(k, nowMs) > 0).length;
  const lost = keys.filter((k) => k.status === "kayip").length;

  return (
    <section id="anahtarlar" className="scroll-mt-24 rounded-[20px] border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
            <KeyRound className="h-4 w-4" /> Anahtar &amp; emanet
          </p>
          <h2 className="mt-1 font-display font-bold text-ink-950">Anahtar takibi</h2>
        </div>
        <div className="flex items-center gap-2">
          {keys.length > 0 ? (
            <p className="text-[11px] text-text-muted">
              {keys.length} anahtar
              {outside > 0 ? ` · ${outside} dışarıda` : ""}
              {overdue > 0 ? ` · ${overdue} gecikmiş` : ""}
              {lost > 0 ? ` · ${lost} kayıp` : ""}
            </p>
          ) : null}
          {canEdit ? (
            <button
              type="button"
              onClick={() => setAdding((v) => !v)}
              aria-expanded={adding}
              className="focus-ring press inline-flex items-center gap-1.5 rounded-[10px] border border-line px-3 py-1.5 text-xs font-semibold text-brand-600 transition hover:border-brand-300"
            >
              <Plus className="h-3.5 w-3.5" /> Anahtar ekle
            </button>
          ) : null}
        </div>
      </div>

      {/* Yeni anahtar formu */}
      {canEdit && adding ? (
        <form
          ref={addFormRef}
          action={addAction}
          className="mt-4 flex flex-wrap items-end gap-2 rounded-[14px] border border-dashed border-line-strong bg-canvas/60 p-3"
        >
          <input type="hidden" name="property_id" value={propertyId} />
          <label className="min-w-[160px] flex-1 text-xs font-semibold text-text-muted">
            Etiket
            <input
              name="label"
              required
              maxLength={80}
              placeholder="Örn. Ana kapı"
              className="mt-1 w-full rounded-[10px] border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand-300"
            />
          </label>
          <label className="min-w-[120px] text-xs font-semibold text-text-muted">
            Anahtar kodu
            <input
              name="key_code"
              maxLength={40}
              placeholder="Etiket / numara"
              className="mt-1 w-full rounded-[10px] border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand-300"
            />
          </label>
          <label className="min-w-[160px] flex-1 text-xs font-semibold text-text-muted">
            Not
            <input
              name="note"
              maxLength={500}
              placeholder="Opsiyonel"
              className="mt-1 w-full rounded-[10px] border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand-300"
            />
          </label>
          <button
            type="submit"
            disabled={addPending}
            className="btn-shine focus-ring press inline-flex h-[38px] items-center gap-1.5 rounded-[10px] bg-brand-600 px-4 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
          >
            <Plus className="h-4 w-4" /> {addPending ? "Ekleniyor…" : "Ekle"}
          </button>
          {addState.error ? (
            <p className="basis-full text-xs font-semibold text-danger-600" role="alert">
              {addState.error}
            </p>
          ) : null}
        </form>
      ) : null}

      {keys.length === 0 ? (
        <div className="mt-4 rounded-[14px] border border-dashed border-line-strong px-4 py-10 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-[14px] bg-brand-600/10 text-brand-600">
            <KeyRound className="h-6 w-6" />
          </span>
          <p className="mt-3 text-sm font-semibold text-ink-950">Bu portföyün anahtar kaydı yok</p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-text-muted">
            Ana kapı, bina girişi ve yedek anahtarları buraya ekleyin; kimde olduğu, iade vadesi ve
            tüm hareket geçmişi otomatik izlensin.
          </p>
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {keys.map((key) => {
            const overdueDays = keyOverdueDays(key, nowMs);
            const history = events[key.id] ?? [];
            const recent = history.slice(0, 5);
            const holder = keyHolderLabel({
              status: key.status,
              staffName: key.holder_staff_name,
              holder_name: key.holder_name,
            });
            return (
              <li
                key={key.id}
                className={`rounded-[14px] border bg-canvas px-4 py-3 transition ${
                  overdueDays > 0 ? "border-danger-500/35 bg-danger-500/[0.03]" : "border-line"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-950">
                      <KeyRound className="h-4 w-4 shrink-0 text-text-faint" />
                      {key.label}
                      {key.key_code ? (
                        <span className="rounded-md bg-ink-950/5 px-1.5 py-0.5 text-[10px] font-bold text-text-muted">
                          #{key.key_code}
                        </span>
                      ) : null}
                      <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${keyStatusTone(key.status)}`}>
                        {keyStatusLabel(key.status)}
                      </span>
                      {overdueDays > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-danger-500/10 px-2 py-0.5 text-[11px] font-bold text-danger-600">
                          <AlertTriangle className="h-3 w-3" /> {overdueDays} gün gecikmiş
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-text-muted">
                      <span className="inline-flex items-center gap-1">
                        <UserRound className="h-3.5 w-3.5" /> {holder}
                        {key.holder_phone ? ` · ${key.holder_phone}` : ""}
                      </span>
                      {isKeyOut(key.status) ? (
                        <>
                          <span>Alındı: {shortDate(key.taken_at)}</span>
                          <span className={overdueDays > 0 ? "font-semibold text-danger-600" : ""}>
                            Vade: {key.due_at ? shortDate(key.due_at) : "süresiz"}
                          </span>
                        </>
                      ) : key.returned_at ? (
                        <span>Son iade: {shortDate(key.returned_at)}</span>
                      ) : null}
                    </p>
                    {key.note ? <p className="mt-1 text-xs text-text-faint">{key.note}</p> : null}
                  </div>

                  {canEdit || canDelete ? (
                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      {canEdit && !isKeyOut(key.status) && key.status !== "kayip" ? (
                        <button
                          type="button"
                          onClick={() => {
                            setCheckoutFor((v) => (v === key.id ? null : key.id));
                            setHolderType("staff");
                          }}
                          aria-expanded={checkoutFor === key.id}
                          className="focus-ring press inline-flex items-center gap-1.5 rounded-[9px] border border-line px-2.5 py-1.5 text-xs font-semibold text-brand-600 transition hover:border-brand-300"
                        >
                          <LogOut className="h-3.5 w-3.5" /> Çıkış ver
                        </button>
                      ) : null}
                      {canEdit && isKeyOut(key.status) ? (
                        <form action={returnPropertyKey}>
                          <input type="hidden" name="key_id" value={key.id} />
                          <button
                            type="submit"
                            className="focus-ring press inline-flex items-center gap-1.5 rounded-[9px] bg-mint-500/12 px-2.5 py-1.5 text-xs font-semibold text-mint-700 transition hover:bg-mint-500/20"
                          >
                            <Undo2 className="h-3.5 w-3.5" /> İade al
                          </button>
                        </form>
                      ) : null}
                      {canEdit && key.status !== "kayip" ? (
                        <ConfirmDialog
                          title="Anahtarı kayıp bildir"
                          description={`"${key.label}" anahtarı kayıp olarak işaretlenecek. Çilingir/kopyalama maliyeti için mal sahibiyle iletişime geçmeyi unutmayın.`}
                          confirmLabel="Kayıp bildir"
                          formAction={reportPropertyKeyLost}
                          hiddenFields={{ key_id: key.id }}
                          trigger={
                            <button
                              type="button"
                              aria-label={`${key.label} anahtarını kayıp bildir`}
                              className="focus-ring press grid h-7 w-7 place-items-center rounded-[8px] text-text-faint transition hover:bg-amber-400/15 hover:text-amber-600"
                              title="Kayıp bildir"
                            >
                              <AlertTriangle className="h-3.5 w-3.5" />
                            </button>
                          }
                        />
                      ) : null}
                      {canDelete ? (
                        <ConfirmDialog
                          title="Anahtar kaydını sil"
                          description={`"${key.label}" anahtarı ve tüm hareket geçmişi silinecek. Bu işlem geri alınamaz.`}
                          confirmLabel="Sil"
                          formAction={deletePropertyKey}
                          hiddenFields={{ key_id: key.id }}
                          trigger={
                            <button
                              type="button"
                              aria-label={`${key.label} anahtarını sil`}
                              className="focus-ring press grid h-7 w-7 place-items-center rounded-[8px] text-text-faint transition hover:bg-danger-500/10 hover:text-danger-600"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          }
                        />
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {/* Çıkış formu — danışman VEYA müşteri */}
                {canEdit && checkoutFor === key.id ? (
                  <form action={outAction} className="hairline-t mt-3 grid gap-2 pt-3 sm:grid-cols-2">
                    <input type="hidden" name="key_id" value={key.id} />
                    <input type="hidden" name="holder_type" value={holderType} />
                    <div className="sm:col-span-2 flex items-center gap-1.5 rounded-[10px] border border-line bg-surface p-1 text-xs font-semibold">
                      {(
                        [
                          ["staff", "Danışman"],
                          ["customer", "Müşteri / 3. kişi"],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setHolderType(value)}
                          aria-pressed={holderType === value}
                          className={`focus-ring flex-1 rounded-[8px] px-3 py-1.5 transition ${
                            holderType === value ? "bg-ink-950 text-white" : "text-text-muted hover:text-ink-950"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    {holderType === "staff" ? (
                      <label className="text-xs font-semibold text-text-muted">
                        Danışman
                        <select
                          name="holder_staff_id"
                          required
                          defaultValue=""
                          className="mt-1 w-full rounded-[10px] border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand-300"
                        >
                          <option value="" disabled>
                            Seçin…
                          </option>
                          {staff.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.full_name ?? "İsimsiz"}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <>
                        <label className="text-xs font-semibold text-text-muted">
                          Kişi adı
                          <input
                            name="holder_name"
                            required
                            maxLength={120}
                            placeholder="Örn. Ayşe Yılmaz"
                            className="mt-1 w-full rounded-[10px] border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand-300"
                          />
                        </label>
                        <label className="text-xs font-semibold text-text-muted">
                          Telefon
                          <input
                            name="holder_phone"
                            maxLength={30}
                            inputMode="tel"
                            placeholder="0555 000 00 00"
                            className="mt-1 w-full rounded-[10px] border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand-300"
                          />
                        </label>
                      </>
                    )}

                    <label className="text-xs font-semibold text-text-muted">
                      İade vadesi
                      <input
                        type="date"
                        name="due_at"
                        defaultValue={defaultDueDate}
                        className="mt-1 w-full rounded-[10px] border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand-300"
                      />
                    </label>
                    <label className="text-xs font-semibold text-text-muted sm:col-span-2">
                      Not
                      <input
                        name="note"
                        maxLength={500}
                        placeholder="Opsiyonel — örn. yer gösterimi için"
                        className="mt-1 w-full rounded-[10px] border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand-300"
                      />
                    </label>
                    <div className="flex items-center gap-2 sm:col-span-2">
                      <button
                        type="submit"
                        disabled={outPending}
                        className="focus-ring press inline-flex items-center gap-1.5 rounded-[10px] bg-brand-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
                      >
                        <LogOut className="h-3.5 w-3.5" /> {outPending ? "Kaydediliyor…" : "Çıkışı kaydet"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setCheckoutFor(null)}
                        className="rounded-[10px] px-3 py-2 text-xs font-semibold text-text-muted hover:bg-canvas"
                      >
                        Vazgeç
                      </button>
                      {outState.error ? (
                        <p className="text-xs font-semibold text-danger-600" role="alert">
                          {outState.error}
                        </p>
                      ) : null}
                    </div>
                  </form>
                ) : null}

                {/* Hareket geçmişi — son 5, genişletilebilir */}
                {history.length > 0 ? (
                  <details className="group mt-2">
                    <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-semibold text-text-faint transition hover:text-brand-600 [&::-webkit-details-marker]:hidden">
                      <History className="h-3.5 w-3.5" />
                      Hareket geçmişi ({history.length})
                      <span className="text-text-faint group-open:hidden">▾</span>
                      <span className="hidden text-text-faint group-open:inline">▴</span>
                    </summary>
                    <ol className="mt-2 space-y-1.5 border-l border-line pl-3">
                      {recent.map((e) => (
                        <li key={e.id} className="text-[11px] text-text-muted">
                          <span className="font-semibold text-ink-950">
                            {EVENT_LABEL[e.action] ?? e.action}
                          </span>
                          {e.holder_name ? ` · ${e.holder_name}` : ""}
                          {e.note ? ` · ${e.note}` : ""}
                          <span className="ml-1 text-text-faint">{dtfLong.format(new Date(e.created_at))}</span>
                        </li>
                      ))}
                    </ol>
                    {/* 5'ten fazlası ikinci bir katmanda — liste uzayıp kartı boğmasın */}
                    {history.length > 5 ? (
                      <details className="mt-1.5 pl-3">
                        <summary className="cursor-pointer list-none text-[11px] font-semibold text-brand-600 [&::-webkit-details-marker]:hidden">
                          Daha eski {history.length - 5} hareket
                        </summary>
                        <ol className="mt-1.5 space-y-1.5 border-l border-line pl-3">
                          {history.slice(5).map((e) => (
                            <li key={e.id} className="text-[11px] text-text-muted">
                              <span className="font-semibold text-ink-950">
                                {EVENT_LABEL[e.action] ?? e.action}
                              </span>
                              {e.holder_name ? ` · ${e.holder_name}` : ""}
                              {e.note ? ` · ${e.note}` : ""}
                              <span className="ml-1 text-text-faint">{dtfLong.format(new Date(e.created_at))}</span>
                            </li>
                          ))}
                        </ol>
                      </details>
                    ) : null}
                  </details>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
