"use client";

import { RowCheckbox } from "@/components/app/bulk-selection";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
} from "react";
import { runWhenIdle } from "@/lib/idle";

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

/** Seçim bağlamı (toplu işlem çubuğu gövdesi de kullanır: customer-bulk-bar.tsx). */
export function useCustomerSelection(): SelectionCtx {
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
  const { selected, setAll } = useCustomerSelection();
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
  return (
    <RowCheckbox
      checked={allSelected}
      disabled={ids.length === 0}
      onToggle={() => setAll(ids, !allSelected)}
      label={allSelected ? "Sayfadaki seçimi kaldır" : "Sayfadaki tüm müşterileri seç"}
    />
  );
}

/** Satır checkbox'ı — ortak `RowCheckbox` (44 px dokunma alanı; overlay linkin üstünde kalır). */
export function CustomerRowCheckbox({ id, name }: { id: string; name: string }) {
  const { selected, toggle } = useCustomerSelection();
  return <RowCheckbox checked={selected.has(id)} onToggle={() => toggle(id)} label={`${name} müşterisini seç`} />;
}

type Advisor = { id: string; full_name: string };

export type CustomerBulkBarProps = {
  advisors: Advisor[];
  tagSuggestions: string[];
  canEdit: boolean;
  canDelete: boolean;
};

/*
 * Toplu işlem çubuğu gövdesi (Radix onay diyaloğu, kişi seçici, toplu eylemler) ilk yük paketine girmez:
 * sayfa açıldıktan sonra boşta bir kez önceden iner ve bağlanır (seçim yokken hiçbir şey çizmez); boşta yüklenmeden
 * önce seçim yapılırsa hemen indirilir. Bağlandıktan sonra bağlı kalır (durumu eskisi gibi seçim temizlense de korunur).
 */
let LoadedBar: ComponentType<CustomerBulkBarProps> | null = null;
let barPromise: Promise<ComponentType<CustomerBulkBarProps>> | null = null;

function loadBar(): Promise<ComponentType<CustomerBulkBarProps>> {
  barPromise ??= import("./customer-bulk-bar").then(
    (m) => (LoadedBar = m.CustomerBulkBarBody),
    (error: unknown) => {
      barPromise = null; // ağ hatasında sonraki seçim yeniden dener
      throw error;
    },
  );
  return barPromise;
}

/** Seçim varken beliren toplu işlem çubuğu: danışman ata + etiket ekle + sil. */
export function CustomerBulkBar(props: CustomerBulkBarProps) {
  const { selected } = useCustomerSelection();
  // Gövde yüklenince HEMEN bağlanır ve bağlı kalır (eskiden de bileşen hep bağlıydı, seçim yokken null çizerdi).
  const [Body, setBody] = useState<ComponentType<CustomerBulkBarProps> | null>(() => LoadedBar);
  const active = selected.size > 0;
  useEffect(() => {
    if (Body) return;
    let live = true;
    const load = () => {
      loadBar()
        .then((C) => {
          if (live) setBody(() => C);
        })
        .catch(() => undefined);
    };
    // Seçim yoksa boşta önceden indir; seçim geldiyse beklemeden indir.
    const cancelIdle = active ? undefined : runWhenIdle(load);
    if (active) load();
    return () => {
      live = false;
      cancelIdle?.();
    };
  }, [Body, active]);
  if (!Body) return null;
  return <Body {...props} />;
}
