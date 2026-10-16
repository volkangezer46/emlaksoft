"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pause, Play, Square, Trash2, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { FormField, FormInput } from "@/components/ui/form-controls";
import { searchCustomers } from "@/app/actions/lookup";
import { deleteSequence, enrollInSequence, stopEnrollment, toggleSequence } from "@/app/actions/sequences";

/** Dizi aç/kapat + sil (detay sayfası başlığı). Dokunma hedefleri Button `touch:` boylarıyla ≥44 px. */
export function SequenceHeaderActions({ id, active }: { id: string; active: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        icon={active ? Pause : Play}
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            setErr(null);
            const res = await toggleSequence(id, !active);
            if (res.error) setErr(res.error);
            else router.refresh();
          })
        }
      >
        {active ? "Duraklat" : "Başlat"}
      </Button>
      <ConfirmDialog
        trigger={<Button variant="ghost" size="sm" icon={Trash2}>Sil</Button>}
        title="Otomatik takip silinsin mi?"
        description="Dizi, adımları ve tüm kayıtların geçmişi kalıcı olarak silinir. Devam eden müşteriler diziden çıkar."
        confirmLabel="Sil"
        onConfirm={async () => {
          const res = await deleteSequence(id);
          if (res.error) setErr(res.error);
          else router.push("/app/otomasyonlar/diziler");
        }}
      />
      {err ? <span className="text-xs text-danger-600" role="alert">{err}</span> : null}
    </div>
  );
}

/** Tek kaydı durdur (satır içi, her zaman görünür; hover'a bağlı değil). */
export function StopEnrollmentButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <ConfirmDialog
        trigger={<Button variant="ghost" size="xs" icon={Square} aria-label={`${name} için diziyi durdur`}>Durdur</Button>}
        title="Bu müşteri için dizi durdurulsun mu?"
        description="Kalan adımlar çalışmaz. Gerekirse müşteriyi daha sonra yeniden kaydedebilirsiniz."
        confirmLabel="Durdur"
        tone="default"
        onConfirm={async () => {
          const res = await stopEnrollment(id);
          if (res.error) setErr(res.error);
          else router.refresh();
        }}
      />
      {err ? <span className="text-xs text-danger-600" role="alert">{err}</span> : null}
    </span>
  );
}

/**
 * Müşteri kaydetme paneli: adla/telefonla arayıp birden çok müşteri seçme ya da bir etiketin tüm müşterilerini
 * (en çok 500) tek seferde ekleme. Zaten devam eden, silinmiş ya da kara listedeki müşteri sunucuda atlanır.
 */
export function EnrollPanel({ sequenceId }: { sequenceId: string }) {
  const router = useRouter();
  const [picked, setPicked] = useState<ComboboxOption[]>([]);
  const [pickerValue, setPickerValue] = useState("");
  const [tag, setTag] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [pool, setPool] = useState<ComboboxOption[]>([]);

  async function search(q: string) {
    const res = await searchCustomers(q);
    setPool((prev) => {
      const seen = new Set(prev.map((o) => o.value));
      return [...prev, ...res.filter((o) => !seen.has(o.value))];
    });
    return res;
  }

  function submit(mode: "pick" | "tag") {
    setMsg(null);
    const fd = new FormData();
    fd.set("sequence_id", sequenceId);
    if (mode === "pick") fd.set("customer_ids", JSON.stringify(picked.map((p) => p.value)));
    else fd.set("tag", tag.trim());
    startTransition(async () => {
      const res = await enrollInSequence(fd);
      if (res.error) {
        setMsg({ tone: "err", text: res.error });
        return;
      }
      const skipped = res.skipped ? ` ${res.skipped} müşteri zaten dizideydi ya da uygun değildi.` : "";
      setMsg({ tone: "ok", text: `${res.enrolled ?? 0} müşteri diziye eklendi.${skipped}` });
      setPicked([]);
      setTag("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="enroll-picker" className="block text-sm font-medium text-ink-950">Müşteri seçin</label>
        <Combobox
          id="enroll-picker"
          options={pool}
          value={pickerValue}
          onValueChange={(v) => {
            const opt = pool.find((o) => o.value === v);
            if (opt && !picked.some((p) => p.value === v) && picked.length < 50) setPicked((prev) => [...prev, opt]);
            setPickerValue("");
          }}
          onSearch={search}
          minSearchLength={2}
          placeholder="Ad ya da telefonla arayın…"
          searchPlaceholder="En az 2 harf yazın"
          emptyText="Müşteri bulunamadı"
        />
        {picked.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="Seçilen müşteriler">
            {picked.map((p) => (
              <li key={p.value} className="inline-flex items-center gap-1 rounded-full border border-line bg-canvas py-0.5 pl-2.5 pr-0.5 text-xs font-semibold text-ink-950">
                {p.label}
                <Button
                  variant="ghost"
                  size="icon"
                  icon={X}
                  aria-label={`${p.label} seçimini kaldır`}
                  className="h-6 w-6"
                  onClick={() => setPicked((prev) => prev.filter((x) => x.value !== p.value))}
                />
              </li>
            ))}
          </ul>
        ) : null}
        <Button icon={UserPlus} size="sm" loading={pending} disabled={picked.length === 0} onClick={() => submit("pick")}>
          {picked.length > 0 ? `${picked.length} müşteriyi ekle` : "Müşteri ekle"}
        </Button>
      </div>

      <div className="hairline-t space-y-2 pt-4">
        <FormField label="Ya da bir etiketin tüm müşterileri" htmlFor="enroll-tag" hint="ör. sicak-alici · en çok 500 müşteri">
          <FormInput value={tag} onChange={(e) => setTag(e.target.value)} maxLength={50} placeholder="Etiket adı" />
        </FormField>
        <Button variant="outline" size="sm" icon={UserPlus} loading={pending} disabled={!tag.trim()} onClick={() => submit("tag")}>
          Etikettekileri ekle
        </Button>
      </div>

      {msg ? (
        <p
          role={msg.tone === "err" ? "alert" : "status"}
          className={msg.tone === "err" ? "text-sm font-medium text-danger-600" : "text-sm font-medium text-mint-700"}
        >
          {msg.text}
        </p>
      ) : null}
    </div>
  );
}
