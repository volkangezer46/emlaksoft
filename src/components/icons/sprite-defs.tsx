import { ArrowRight, Check, Clock, Scale, ShieldCheck, type LucideIcon } from "lucide-react";
import type { SpriteIconName } from "./sprite-icon";

/**
 * Public sayfalarda çok tekrar eden ikonların TEK tanımı (kök layout'ta bir kez basılır).
 * Kullanım: `<SpriteIcon name="check" />` (`./sprite-icon`) — her örnek ~80 bayt `<use>`;
 * satır içi lucide SVG'si ~600 bayt ve HTML + RSC verisinde iki kez gidiyordu (ana sayfada 100+ örnek).
 */
export const SPRITE_ICONS = {
  check: Check,
  "arrow-right": ArrowRight,
  "shield-check": ShieldCheck,
  scale: Scale,
  clock: Clock,
} as const satisfies Record<SpriteIconName, LucideIcon>;

export function IconSpriteDefs() {
  return (
    <svg aria-hidden="true" focusable="false" width="0" height="0" style={{ position: "absolute", overflow: "hidden" }}>
      {Object.entries(SPRITE_ICONS).map(([id, Icon]) => (
        <symbol key={id} id={`si-${id}`} viewBox="0 0 24 24">
          <Icon />
        </symbol>
      ))}
    </svg>
  );
}
