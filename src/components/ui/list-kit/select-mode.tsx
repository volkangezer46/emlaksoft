"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { CheckSquare, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useKitSimpleMode } from "@/components/ui/simple-kit";

/**
 * "Seç" modu (sadeleştirme planı 2.1): sade modda liste satırlarındaki toplu seçim kutuları gizli gelir; kullanıcı
 * "Seç" düğmesine basınca görünür, "Seçimi bitir" ile yeniden gizlenir. Tam modda kutular her zaman görünür
 * (`always`) ve düğme çizilmez. Hiçbir toplu işlem silinmez, yalnız bir dokunuş arkasına katlanır.
 *
 * Gizleme CSS iledir (premium.css `[data-select-mode="off"]`): tablo hücresinde yalnız onay kutusu taşıyan sütun
 * (`RowCheckbox`, DataTable `Checkbox`) ve `data-row-select` işaretli öğeler. Böylece satırları SUNUCUDA çizen
 * listeler de değişmeden uyar. "Seç" satırı yalnız kapsamda seçim kutusu VARSA görünür (CSS `:has`).
 */
export type SelectMode = "always" | "on" | "off";

const SelectModeContext = createContext<{ mode: SelectMode; setOn: (on: boolean) => void }>({
  mode: "always",
  setOn: () => undefined,
});

export function useSelectMode(): SelectMode {
  return useContext(SelectModeContext).mode;
}

/** Liste kapsamı (ListPage kökü bunu kullanır): `data-select-mode` ve sade mod işareti `data-simple`. */
export function SelectModeScope({ children, className }: { children: ReactNode; className?: string }) {
  const simple = useKitSimpleMode();
  const [on, setOn] = useState(false);
  const mode: SelectMode = simple ? (on ? "on" : "off") : "always";
  return (
    <SelectModeContext value={{ mode, setOn }}>
      <div data-select-mode={mode} data-simple={simple ? "1" : undefined} className={className}>
        {children}
      </div>
    </SelectModeContext>
  );
}

/**
 * "Seç" / "Seçimi bitir" düğmesi (yalnız sade modda; seçim kutusu olmayan listede CSS ile gizli). `inToolbar`: liste
 * araç çubuğunun satırında (Filtreler'in yanında) çizilir; o zaman ListPage'in ayrı "Seç" satırı gizlenir (CSS) —
 * telefonda başlığın üstünde boş bir satır kalmaz.
 */
export function SelectModeToggle({ inToolbar = false }: { inToolbar?: boolean }) {
  const { mode, setOn } = useContext(SelectModeContext);
  if (mode === "always") return null;
  const on = mode === "on";
  const Wrap = inToolbar ? "span" : "div";
  return (
    <Wrap className={inToolbar ? "sel-toggle-tb" : "sel-toggle-row"}>
      {/* Araç çubuğunda telefonda (<640 px) 44 px'lik ikon düğme (etiket ekran okuyucuda kalır): arama kutusu daralmaz. */}
      <Button
        variant="outline"
        size="sm"
        icon={on ? X : CheckSquare}
        aria-pressed={on}
        title={on ? "Seçimi bitir" : "Seç"}
        className={inToolbar ? "max-sm:w-11 max-sm:justify-center max-sm:px-0" : undefined}
        onClick={() => setOn(!on)}
      >
        <span className={inToolbar ? "max-sm:sr-only" : undefined}>{on ? "Seçimi bitir" : "Seç"}</span>
      </Button>
    </Wrap>
  );
}
