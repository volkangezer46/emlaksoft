/**
 * Anlaşma panosu — sürükle-bırak altyapısı (@dnd-kit/core). Yalnız `deal-board.tsx` içe aktarır;
 * pano parçası `deal-board-lazy.tsx` ile ayrıldığı için liste görünümü bu modülü indirmez.
 *
 * Üç giriş yolu, üçü de aynı kararı (`board-logic.ts`) üretir:
 *   - Fare/kalem: 6 px hareketten sonra başlar (tıklama ile sürükleme ayrışır).
 *   - Dokunma: ~200 ms basılı tutunca başlar (kaydırma ile çakışmaz); tutamaçta beklemeden başlar.
 *   - Klavye: tutamaçta Boşluk/Enter ile tut, sol/sağ okla sütun değiştir, Boşluk/Enter bırak, Esc iptal.
 */
import type { PointerEvent as ReactPointerEvent, TouchEvent as ReactTouchEvent } from "react";
import {
  KeyboardCode,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  type AutoScrollOptions,
  type CollisionDetection,
  type KeyboardCodes,
  type KeyboardCoordinateGetter,
  type KeyboardSensorOptions,
  type PointerSensorOptions,
  type TouchSensorOptions,
} from "@dnd-kit/core";
import { isDealStage } from "@/lib/workflow-state";
import { adjacentColumn, columnOf } from "./board-logic";

/** Sürüklenen kartın taşıdığı veri (duyurular ve klavye için). */
export type BoardDragData = { title: string; stage: string };

/**
 * Kart içindeki düğme satırı sürüklemeyi başlatmaz: "Geçiş" menüsü (Radix) pointerdown'da açılır;
 * oradan menü öğesine uzanan hareket kartı sürüklemeye çevirmemelidir.
 */
const NO_DRAG_ATTR = "data-board-no-drag";
export const NO_DRAG_PROPS = { [NO_DRAG_ATTR]: "" } as const;

function startsOnControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(`[${NO_DRAG_ATTR}]`) !== null;
}

/** Fare ve kalem. Dokunma burada BAŞLAMAZ: gecikmeli `BoardTouchSensor`'a bırakılır. */
export class BoardPointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: "onPointerDown" as const,
      handler: ({ nativeEvent: event }: ReactPointerEvent, { onActivation }: PointerSensorOptions) => {
        if (!event.isPrimary || event.button !== 0 || event.pointerType === "touch") return false;
        if (startsOnControl(event.target)) return false;
        onActivation?.({ event });
        return true;
      },
    },
  ];
}

/** Dokunma: basılı tutma gecikmesiyle başlar; gecikme içinde parmak kayarsa sayfa kaydırılır. */
export class BoardTouchSensor extends TouchSensor {
  static activators = [
    {
      eventName: "onTouchStart" as const,
      handler: ({ nativeEvent: event }: ReactTouchEvent, { onActivation }: TouchSensorOptions) => {
        if (event.touches.length > 1) return false;
        if (startsOnControl(event.target)) return false;
        onActivation?.({ event });
        return true;
      },
    },
  ];
}

export const POINTER_SENSOR_OPTIONS: PointerSensorOptions = {
  activationConstraint: { distance: 6 },
};

export const TOUCH_SENSOR_OPTIONS: TouchSensorOptions = {
  activationConstraint: { delay: 200, tolerance: 8 },
  // Tutamaç (44 px, touch-action: none) dokunulduğu anda tutar; kartın geri kalanı gecikmelidir.
  bypassActivationConstraint: ({ event, activeNode }) => {
    const handle = activeNode.activatorNode.current;
    return handle !== null && event.target instanceof Node && handle.contains(event.target);
  },
};

/** Tab bırakmaz, iptal eder: odak kayarken yanlışlıkla aşama değişmesin. */
const KEYBOARD_CODES: KeyboardCodes = {
  start: [KeyboardCode.Space, KeyboardCode.Enter],
  cancel: [KeyboardCode.Esc, KeyboardCode.Tab],
  end: [KeyboardCode.Space, KeyboardCode.Enter],
};

/**
 * Klavye: sol/sağ ok kartı komşu sütunun üzerine taşır (25 px'lik varsayılan adım yerine).
 * Yalnız yatay koordinat değişir; hedef sütun görünür alanın dışındaysa dnd-kit yatay
 * kaydırıcıyı (pano) kendisi kaydırır. Yukarı/aşağı ok sürüklerken etkisizdir.
 */
export const boardKeyboardCoordinates: KeyboardCoordinateGetter = (event, { currentCoordinates, context }) => {
  if (event.code === KeyboardCode.Up || event.code === KeyboardCode.Down) {
    event.preventDefault();
    return undefined;
  }
  const direction = event.code === KeyboardCode.Right ? 1 : event.code === KeyboardCode.Left ? -1 : 0;
  if (direction === 0) return undefined;
  event.preventDefault();

  const { active, over, collisionRect, droppableRects } = context;
  if (!active || !collisionRect) return undefined;
  const origin = (active.data.current as BoardDragData | undefined)?.stage ?? "new";
  const overId = over ? String(over.id) : null;
  const current = overId !== null && isDealStage(overId) ? overId : columnOf(origin);
  const target = adjacentColumn(current, direction);
  const targetRect = target ? droppableRects.get(target) : undefined;
  if (!targetRect) return undefined;

  return {
    x: targetRect.left + (targetRect.width - collisionRect.width) / 2,
    y: currentCoordinates.y,
  };
};

export const KEYBOARD_SENSOR_OPTIONS: KeyboardSensorOptions = {
  coordinateGetter: boardKeyboardCoordinates,
  keyboardCodes: KEYBOARD_CODES,
  scrollBehavior: "smooth",
};

/** Hareket azaltma tercihi: klavyeyle sütun değiştirirken pano kaydırması anlık olur. */
export const KEYBOARD_SENSOR_OPTIONS_REDUCED: KeyboardSensorOptions = {
  ...KEYBOARD_SENSOR_OPTIONS,
  scrollBehavior: "auto",
};

/**
 * Hedef sütun: işaretçi varken (fare/dokunma/kalem) işaretçinin altındaki sütun; klavyede
 * işaretçi olmadığı için kartın en çok örtüştüğü sütun.
 */
export const boardCollisionDetection: CollisionDetection = (args) =>
  args.pointerCoordinates ? pointerWithin(args) : rectIntersection(args);

/**
 * Kenara yaklaşınca otomatik kaydırma: mobilde yatay kayan sütunlar ve sayfanın kendisi.
 * Eşik, kaydırıcının kenarından itibaren boyutunun oranıdır.
 */
export const BOARD_AUTO_SCROLL: AutoScrollOptions = {
  threshold: { x: 0.2, y: 0.15 },
  acceleration: 12,
};
