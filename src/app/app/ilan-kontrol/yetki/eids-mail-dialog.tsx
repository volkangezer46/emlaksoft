"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClipboardPaste, FileUp, MailPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { FileInput } from "@/components/ui/file-input";
import { FormTextarea } from "@/components/ui/form-controls";
import { useToast } from "@/components/app/toast-provider";
import { pasteEidsText, uploadEidsEml, type EidsActionResult } from "@/app/actions/eids-inbound";

type Mode = "eml" | "paste";

/** Dosyayı baytı baytına base64'e çevirir (DKIM imzası korunur; sunucuya ikili gövde gitmez). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? "").replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/**
 * "Bakanlık e-postası ekle" diyaloğu (İlan Kontrol > Yetki > Bakanlık e-postaları). DNS/port açılana kadar ana yol
 * budur ve TAM çalışır:
 *  - .eml yükleme: SMTP ile aynı kaynak doğrulamasından geçer (DKIM/ARC korunur); doğrulanır ve tek portföyle birebir
 *    eşleşirse ayara göre kendiliğinden uygulanır.
 *  - Metin yapıştırma (telefon): her zaman "doğrulanamadı" sayılır, onay kuyruğuna düşer.
 */
export function EidsMailDialog({ canEdit }: { canEdit: boolean }) {
  const router = useRouter();
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("eml");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!canEdit) return null;

  const done = (r: EidsActionResult) => {
    if (r.error) {
      setError(r.error);
      return;
    }
    if (r.info) push(r.info, "ok");
    setOpen(false);
    setText("");
    setFile(null);
    router.refresh();
  };

  const submit = () => {
    setError(null);
    start(async () => {
      if (mode === "eml") {
        if (!file) {
          setError("Ne oldu: dosya seçilmedi. Ne yapmalı: e-postayı .eml olarak indirip seçin.");
          return;
        }
        if (file.size > 256 * 1024) {
          setError("Ne oldu: dosya 256 KB sınırını aşıyor. Ne yapmalı: Bakanlık e-postasını eksiz indirin ya da metnini yapıştırın.");
          return;
        }
        done(await uploadEidsEml({ name: file.name, base64: await fileToBase64(file) }));
      } else {
        done(await pasteEidsText(text));
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setError(null); }}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="primary" icon={MailPlus}>
          Bakanlık e-postası ekle
        </Button>
      </DialogTrigger>
      <DialogContent size="md">
        <DialogHeader
          icon={<MailPlus />}
          title="Bakanlık e-postası ekle"
          description="eids.yetki@ticaret.gov.tr adresinden gelen yetki verme / iptal e-postasını ekleyin."
        />
        <DialogBody className="space-y-4">
          <div aria-label="Ekleme yolu" className="flex flex-wrap gap-1.5">
            <Button type="button" size="sm" variant={mode === "eml" ? "secondary" : "ghost"} icon={FileUp} aria-pressed={mode === "eml"} onClick={() => setMode("eml")}>
              .eml yükle
            </Button>
            <Button type="button" size="sm" variant={mode === "paste" ? "secondary" : "ghost"} icon={ClipboardPaste} aria-pressed={mode === "paste"} onClick={() => setMode("paste")}>
              Metni yapıştır
            </Button>
          </div>
          {mode === "eml" ? (
            <div className="space-y-2">
              <FileInput accept=".eml,message/rfc822" onChange={(e) => setFile(e.target.files?.[0] ?? null)} buttonLabel=".eml dosyası seç" />
              <p className="text-xs text-text-muted">
                Gmail: e-postayı açın, ⋮ menüsü &gt; &quot;İletiyi indir&quot;. Outlook: &quot;Farklı kaydet&quot;. En güvenli yol budur: gönderen Bakanlık imzasıyla
                doğrulanır.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <FormTextarea
                rows={7}
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={20000}
                aria-label="E-posta metni"
                placeholder="… taşınmaz numaralı taşınmazın satışına ilişkin … tarafından … tarihine kadar yetkilendirildiniz."
              />
              <p className="text-xs text-text-muted">
                Yapıştırılan metnin kaynağı doğrulanamaz; uygulanmadan önce ofis sahibi, genel müdür ya da şube müdürü onaylar.
              </p>
            </div>
          )}
          {error ? (
            <p role="alert" className="text-xs text-danger-text">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              Vazgeç
            </Button>
          </DialogClose>
          <Button type="button" variant="primary" loading={pending} onClick={submit} disabled={mode === "paste" ? !text.trim() : !file}>
            Ekle
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
