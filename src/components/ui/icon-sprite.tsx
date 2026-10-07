import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Building2,
  CalendarPlus,
  CheckCircle2,
  Clock3,
  Crosshair,
  Eye,
  FileCheck2,
  FileSignature,
  Handshake,
  KeyRound,
  Layers,
  Mail,
  MapPin,
  MessageCircle,
  MessageSquare,
  Pencil,
  Phone,
  Radio,
  Sparkles,
  Undo2,
  User,
  XCircle,
} from "lucide-react";
import { __iconNode as n_alert_triangle } from "lucide-react/dist/esm/icons/triangle-alert.mjs";
import { __iconNode as n_building_2 } from "lucide-react/dist/esm/icons/building-2.mjs";
import { __iconNode as n_calendar_plus } from "lucide-react/dist/esm/icons/calendar-plus.mjs";
import { __iconNode as n_check_circle_2 } from "lucide-react/dist/esm/icons/circle-check.mjs";
import { __iconNode as n_clock_3 } from "lucide-react/dist/esm/icons/clock-3.mjs";
import { __iconNode as n_crosshair } from "lucide-react/dist/esm/icons/crosshair.mjs";
import { __iconNode as n_eye } from "lucide-react/dist/esm/icons/eye.mjs";
import { __iconNode as n_file_check_2 } from "lucide-react/dist/esm/icons/file-check-corner.mjs";
import { __iconNode as n_file_signature } from "lucide-react/dist/esm/icons/file-pen-line.mjs";
import { __iconNode as n_handshake } from "lucide-react/dist/esm/icons/handshake.mjs";
import { __iconNode as n_key_round } from "lucide-react/dist/esm/icons/key-round.mjs";
import { __iconNode as n_layers } from "lucide-react/dist/esm/icons/layers.mjs";
import { __iconNode as n_mail } from "lucide-react/dist/esm/icons/mail.mjs";
import { __iconNode as n_map_pin } from "lucide-react/dist/esm/icons/map-pin.mjs";
import { __iconNode as n_message_circle } from "lucide-react/dist/esm/icons/message-circle.mjs";
import { __iconNode as n_message_square } from "lucide-react/dist/esm/icons/message-square.mjs";
import { __iconNode as n_pencil } from "lucide-react/dist/esm/icons/pencil.mjs";
import { __iconNode as n_phone } from "lucide-react/dist/esm/icons/phone.mjs";
import { __iconNode as n_radio } from "lucide-react/dist/esm/icons/radio.mjs";
import { __iconNode as n_sparkles } from "lucide-react/dist/esm/icons/sparkles.mjs";
import { __iconNode as n_undo_2 } from "lucide-react/dist/esm/icons/undo-2.mjs";
import { __iconNode as n_user } from "lucide-react/dist/esm/icons/user.mjs";
import { __iconNode as n_x_circle } from "lucide-react/dist/esm/icons/circle-x.mjs";

/**
 * Tek SVG <symbol> sprite'i: liste satirlarinda tekrarlanan ikonlar her satirda yeniden basilmaz;
 * kabukta (app + admin layout) BIR kez basilir, satirlar `<svg><use href="#i-..."/></svg>` kullanir.
 * Yalniz sik tekrarlananlar burada; tek seferlik ikonlar dogrudan lucide kalir.
 */
const NODES = {
  "alert-triangle": n_alert_triangle,
  "building-2": n_building_2,
  "calendar-plus": n_calendar_plus,
  "check-circle-2": n_check_circle_2,
  "clock-3": n_clock_3,
  crosshair: n_crosshair,
  eye: n_eye,
  "file-check-2": n_file_check_2,
  "file-signature": n_file_signature,
  handshake: n_handshake,
  "key-round": n_key_round,
  layers: n_layers,
  mail: n_mail,
  "map-pin": n_map_pin,
  "message-circle": n_message_circle,
  "message-square": n_message_square,
  pencil: n_pencil,
  phone: n_phone,
  radio: n_radio,
  sparkles: n_sparkles,
  "undo-2": n_undo_2,
  user: n_user,
  "x-circle": n_x_circle,
} as const;

export type SpriteIconName = keyof typeof NODES;

const BY_COMPONENT = new Map<unknown, SpriteIconName>([
  [AlertTriangle, "alert-triangle"],
  [Building2, "building-2"],
  [CalendarPlus, "calendar-plus"],
  [CheckCircle2, "check-circle-2"],
  [Clock3, "clock-3"],
  [Crosshair, "crosshair"],
  [Eye, "eye"],
  [FileCheck2, "file-check-2"],
  [FileSignature, "file-signature"],
  [Handshake, "handshake"],
  [KeyRound, "key-round"],
  [Layers, "layers"],
  [Mail, "mail"],
  [MapPin, "map-pin"],
  [MessageCircle, "message-circle"],
  [MessageSquare, "message-square"],
  [Pencil, "pencil"],
  [Phone, "phone"],
  [Radio, "radio"],
  [Sparkles, "sparkles"],
  [Undo2, "undo-2"],
  [User, "user"],
  [XCircle, "x-circle"],
]);

/** Lucide bilesenine karsilik gelen sprite adi (yoksa undefined). */
export function spriteNameOf(icon: LucideIcon): SpriteIconName | undefined {
  return BY_COMPONENT.get(icon);
}

/** Kabukta bir kez render edilir; gorunmez ve erisilebilirlik agacinda yoktur. */
export function IconSprite() {
  return (
    <svg aria-hidden="true" focusable="false" width="0" height="0" style={{ position: "absolute" }} data-icon-sprite="">
      <defs>
        {(Object.keys(NODES) as SpriteIconName[]).map((name) => (
          <symbol key={name} id={`i-${name}`} viewBox="0 0 24 24">
            {NODES[name].map(([tag, attrs], i) => {
              const rest: Record<string, string | number> = { ...attrs };
              delete rest.key;
              const Tag = tag as "path";
              return <Tag key={i} {...rest} />;
            })}
          </symbol>
        ))}
      </defs>
    </svg>
  );
}

/** Sprite'tan ikon: lucide ile ayni cizgi stili (24 viewBox, 2px, yuvarlak uc), currentColor. */
export function SpriteIcon({ name, className }: { name: SpriteIconName; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <use href={`#i-${name}`} />
    </svg>
  );
}

/** Lucide bileseni sprite'ta varsa SpriteIcon, yoksa bilesenin kendisi (aria-hidden korunur). */
export function SmartIcon({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  const name = spriteNameOf(Icon);
  if (name) return <SpriteIcon name={name} className={className} />;
  return <Icon aria-hidden="true" className={className} />;
}
