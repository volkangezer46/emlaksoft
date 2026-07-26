"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useTransition,
} from "react";
import { Flame, Tag, Trash2, UserCog, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  bulkAddTag,
  bulkAssignCustomers,
  bulkDeleteCustomers,
  bulkReheatCustomers,
} from "@/app/actions/customers";

/**
 * Müşteri listesinde toplu seçim + toplu işlem.
 *
 * MİMARİ: Tablo satırları Server Component'te render edilir (avatar, lead
 * rozeti, tel/wa linkleri…). Seçim durumu ise client state ister. Bu yüzden
 * satırların İÇİNE gömülen küçük client parçalar (checkbox'lar) ile üstte
 * beliren aksiyon çubuğu, ortak bir Context sağlayıcısı üzerinden konuşur —
 * sayfa server'da kalır, client'a yalnızca seçim mantığı iner.
 * (bkz. portfoyler/property-bulk-actions.tsx — oradaki standalone listenin
 * paylaşılan tabloya uyarlanmış hali)
 */

type SelectionCtx = {
  selected: Set<string>;
  toggle: (id: string) => void;
  setAll: (ids: string[], on: boolean) => void;
  clear: () => void;
};

const Ctx = createContext<SelectionCtx | null>(null);

function useSelection(): SelectionCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("CustomerBulkProvider içinde kullanılmalı");
  return ctx;
}

export function CustomerBulkProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setAll = useCallback((ids: string[], on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const value = useMemo(
    () => ({ selected, toggle, setAll, clear }),
    [selected, toggle, setAll, clear],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Başlık hücresi — sayfadaki tüm satırları seç/bırak. */
export function CustomerSelectAllCheckbox({ ids }: { ids: string[] }) {
  const { selected, setAll } = useSelection();
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
  return (
    <input
      type="checkbox"
      checked={allSelected}
      disabled={ids.length === 0}
      onChange={() => setAll(ids, !allSelected)}
      aria-label={allSelected ? "Sayfadaki seçimi kaldır" : "Sayfadaki tüm müşterileri seç"}
      className="h-4 w-4 cursor-pointer accent-brand-600"
    />
  );
}

/** Satır checkbox'ı — relative z-10: satırı kaplayan overlay linkin üstünde kalır. */
export function CustomerRowCheckbox({ id, name }: { id: string; name: string }) {
  const { selected, toggle } = useSelection();
  return (
    <input
      type="checkbox"
      checked={selected.has(id)}
      onChange={() => toggle(id)}
      aria-label={`${name} müşterisini seç`}
      className="relative z-10 h-4 w-4 cursor-pointer accent-brand-600"
    />
  );
}

type Advisor = { id: string; full_name: string };

/** Seçim varken beliren toplu işlem çubuğu: danışman ata + etiket ekle + sil. */
export function CustomerBulkBar({
  advisors,
  tagSuggestions,
  canEdit,
  canDelete,
}: {
  advisors: Advisor[];
  tagSuggestions: string[];
  canEdit: boolean;
  canDelete: boolean;
}) {
  const { selected, clear } = useSelection();
  const [assignOpen, setAssignOpen] = useState(false);
  const [advisor, setAdvisor] = useState("");
  const [tagOpen, setTagOpen] = useState(false);
  const [tag, setTag] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (selected.size === 0) return null;
  const ids = [...selected];

  const handleAssign = () => {
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const res = await bulkAssignCustomers(ids, advisor);
      if (res.error) {
        setError(res.error);
        return;
      }
      setAssignOpen(false);
      clear();
    });
  };

  const handleAddTag = () => {
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const res = await bulkAddTag(ids, tag);
      if (res.error) {
        setError(res.error);
        return;
      }
      setTagOpen(false);
      setTag("");
      clear();
    });
  };

  const handleDelete = async () => {
    setError(null);
    setInfo(null);
    const res = await bulkDeleteCustomers(ids);
    if (res.error) setError(res.error);
    else clear();
  };

  /** Uykuda müşteri aksiyonu: seçililere "Ara: … — uzun süredir temassız" görevi açar. */
  const handleReheat = async () => {
    setError(null);
    setInfo(null);
    const res = await bulkReheatCustomers(ids);
    if (res.error) {
      setError(res.error);
    } else {
      // clear() ÇAĞRILMAZ: seçim sıfırlanınca bar unmount olur ve bilgi
      // mesajı hiç görünmezdi. Kullanıcı X ile veya yeni işlemle temizler.
      setInfo(`${res.updatedCount ?? 0} müşteri için arama görevi oluşturuldu.`);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[14px] border border-brand-300/40 bg-brand-600/[0.04] px-4 py-2.5">
      <span className="text-sm font-semibold text-brand-700">
        {selected.size} müşteri seçildi
      </span>

      {canEdit && advisors.length > 0 ? (
        <Dialog
          open={assignOpen}
          onOpenChange={(open) => {
            setAssignOpen(open);
            if (!open) setError(null);
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm">
              <UserCog className="h-3.5 w-3.5" /> Danışman ata
            </Button>
          </DialogTrigger>
          <DialogContent size="sm">
            <DialogHeader
              icon={<UserCog />}
              title="Danışman ata"
              description={`${ids.length} müşteri seçili — hepsi aynı danışmana atanır.`}
            />
            <DialogBody>
              <label
                htmlFor="bulk-assign-advisor"
                className="mb-1.5 block text-xs font-semibold text-text-muted"
              >
                Danışman
              </label>
              <select
                id="bulk-assign-advisor"
                value={advisor}
                onChange={(e) => setAdvisor(e.target.value)}
                className="w-full rounded-[11px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400"
              >
                <option value="">Atamayı kaldır (danışmansız)</option>
                {advisors.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.full_name}
                  </option>
                ))}
              </select>
              {error ? <p className="mt-2 text-xs font-semibold text-danger-500">{error}</p> : null}
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="secondary">Vazgeç</Button>
              </DialogClose>
              <Button loading={pending} onClick={handleAssign}>
                Ata
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {canEdit ? (
        <Dialog
          open={tagOpen}
          onOpenChange={(open) => {
            setTagOpen(open);
            if (!open) setError(null);
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm" variant="secondary">
              <Tag className="h-3.5 w-3.5" /> Etiket ekle
            </Button>
          </DialogTrigger>
          <DialogContent size="sm">
            <DialogHeader
              icon={<Tag />}
              title="Etiket ekle"
              description={`${ids.length} müşteri seçili — etiket hepsine eklenir, zaten ekli olanlara mükerrer yazılmaz.`}
            />
            <DialogBody>
              <label
                htmlFor="bulk-tag-input"
                className="mb-1.5 block text-xs font-semibold text-text-muted"
              >
                Etiket
              </label>
              <input
                id="bulk-tag-input"
                list="bulk-tag-options"
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && tag.trim() && !pending) {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
                maxLength={30}
                placeholder="Örn: VIP, Yatırımcı, Takipte…"
                className="w-full rounded-[11px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400"
              />
              {/* Tenant'ın mevcut etiketleri öneri olarak düşer; yeni etiket de yazılabilir */}
              <datalist id="bulk-tag-options">
                {tagSuggestions.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
              {error ? <p className="mt-2 text-xs font-semibold text-danger-500">{error}</p> : null}
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="secondary">Vazgeç</Button>
              </DialogClose>
              <Button loading={pending} disabled={!tag.trim()} onClick={handleAddTag}>
                Ekle
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {canEdit ? (
        <ConfirmDialog
          trigger={
            <Button size="sm" variant="secondary">
              <Flame className="h-3.5 w-3.5 text-amber-500" /> Yeniden ısıt
            </Button>
          }
          title={`${ids.length} müşteri yeniden ısıtılsın mı?`}
          description="Her seçili müşteri için danışmanına yüksek öncelikli 'Ara: uzun süredir temassız' görevi oluşturulur (2 gün vadeli). Zaten açık ısıtma görevi olan müşteriler atlanır."
          confirmLabel="Görev oluştur"
          onConfirm={handleReheat}
        />
      ) : null}

      {canDelete ? (
        <ConfirmDialog
          trigger={
            <Button size="sm" variant="danger">
              <Trash2 className="h-3.5 w-3.5" /> Sil
            </Button>
          }
          title={`${ids.length} müşteri silinsin mi?`}
          description="Seçili müşteriler listeden kaldırılır (soft delete). Bağlı talep ve görüşme geçmişi korunur."
          confirmLabel="Sil"
          onConfirm={handleDelete}
        />
      ) : null}

      {error ? (
        <span className="text-xs font-semibold text-danger-500" role="alert">
          {error}
        </span>
      ) : null}
      {info ? (
        <span className="text-xs font-semibold text-mint-600" role="status">
          {info}
        </span>
      ) : null}

      <button
        type="button"
        onClick={() => {
          clear();
          setError(null);
          setInfo(null);
        }}
        className="ml-auto grid h-7 w-7 min-h-9 min-w-9 place-items-center rounded-[7px] text-text-muted transition hover:bg-line"
        aria-label="Seçimi temizle"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
