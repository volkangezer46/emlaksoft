import { NEVER_TYPES, isPlaceholderOption, splitIdentifier, type ControlDescriptor } from "./fill-plan";
import { LABEL_SOURCES, isPersonalLabel, type LabelSource } from "./feedback-format";
import { fold } from "./rules";
import { sha256Hex } from "./rules-verify";

/**
 * FORM ŞEMASI VE İMZALARI (SAF; WebCrypto sha256, testli). Öğrenme sinyalinin kimliği budur:
 *  - alan imzası  = sha256(etiket | tür | sıralı seçenekler)  → aynı soru farklı ofislerde aynı imzayı verir;
 *  - çapa         = imzanın ilk 16 hex'i (kural setindeki `anchors`);
 *  - form parmak izi = sha256(sıralı benzersiz "etiket|tür" kümesi) → portal formu değişti mi.
 * Kişisel denetimler (telefon/e-posta/parola türleri ve HERHANGİ bir etiketi — komşu metin dahil — kişisel sözcük içeren
 * denetimler; liste `feedback-format.ts: PERSONAL_LABEL_WORDS`) şemaya HİÇ girmez. Gönderilecek etiket yalnız denetime BAĞLI
 * kaynaklardan alınır (`ControlDescriptor.sources`); komşu metin kullanılmaz.
 */

export type ShapeControl = "text" | "number" | "textarea" | "choice" | "bool";

export type FieldShape = {
  /** Bu soruya ait denetim sıra numaraları (radyo grubunda birden çok). */
  idxs: number[];
  /** Katlanmış, ≤60 karakter; bağlı etiket yoksa boş. */
  label: string;
  /** Etiketin geldiği bağlı kaynak (label yoksa "name"; zaten boş etiketli alan gönderilmez). */
  labelSource: LabelSource;
  control: ShapeControl;
  /** Katlanmış seçenek metinleri (yer tutucular hariç; sayfa sırası). */
  options: string[];
  required: boolean;
};

export type SignedShape = FieldShape & { sig: string; anchor: string };

/** Kişisel türler: hiçbir zaman şemaya girmez (doldurmanın `NEVER_TYPES` kümesinin üst kümesi). */
const PERSONAL_TYPES = new Set(["tel", "email", "password", "file", "hidden"]);

export function isPersonalControl(d: Pick<ControlDescriptor, "type" | "labels">): boolean {
  if (PERSONAL_TYPES.has(d.type)) return true;
  return d.labels.some((raw) => isPersonalLabel(splitIdentifier(raw)));
}

function controlOf(d: ControlDescriptor): ShapeControl {
  if (d.tag === "select" || d.type === "radio") return "choice";
  if (d.type === "checkbox") return "bool";
  if (d.tag === "textarea") return "textarea";
  if (d.type === "number") return "number";
  return "text";
}

/** Bağlı kaynakların tercih sırası (görünen etiket önce, teknik ad/kimlik en son). */
const SOURCE_ORDER: readonly LabelSource[] = ["label_for", "aria_label", "aria_labelledby", "legend", "placeholder", "name", "id"];

function boundLabel(descs: readonly ControlDescriptor[]): { label: string; labelSource: LabelSource } {
  for (const want of SOURCE_ORDER) {
    for (const d of descs) {
      const sources = d.sources ?? [];
      for (let i = 0; i < sources.length && i < d.labels.length; i += 1) {
        if (sources[i] !== want || !(LABEL_SOURCES as readonly string[]).includes(want)) continue;
        const f = fold(splitIdentifier(d.labels[i]!));
        if (f.length >= 2 && /[a-z]/.test(f)) return { label: f.slice(0, 60), labelSource: want };
      }
    }
  }
  return { label: "", labelSource: "name" };
}

/**
 * Görünür, kişisel olmayan ve doldurulabilir türdeki denetimlerden soru şemalarını çıkarır (radyo grubu tek soru).
 * `personal`: atlanan kişisel denetim sayısı (yalnız sayaç olarak gönderilir).
 */
export function formShapes(descs: readonly ControlDescriptor[]): { shapes: FieldShape[]; personal: number } {
  const shapes: FieldShape[] = [];
  const groups = new Map<string, ControlDescriptor[]>();
  let personal = 0;
  for (const d of descs) {
    if (!d.visible || NEVER_TYPES.has(d.type)) {
      if (PERSONAL_TYPES.has(d.type)) personal += 1;
      continue;
    }
    if (isPersonalControl(d)) {
      personal += 1;
      continue;
    }
    if (d.type === "radio" && d.group) {
      const arr = groups.get(d.group) ?? [];
      arr.push(d);
      groups.set(d.group, arr);
      continue;
    }
    const options = d.tag === "select" ? d.options.filter((o) => !isPlaceholderOption(o)).map((o) => fold(o)).filter(Boolean) : [];
    shapes.push({ idxs: [d.idx], ...boundLabel([d]), control: controlOf(d), options, required: d.required === true });
  }
  for (const members of groups.values()) {
    shapes.push({
      idxs: members.map((m) => m.idx),
      ...boundLabel(members),
      control: "choice",
      options: members.map((m) => fold(m.optionText)).filter(Boolean),
      required: members.some((m) => m.required === true),
    });
  }
  return { shapes: shapes.sort((a, b) => a.idxs[0]! - b.idxs[0]!), personal };
}

export function fieldSig(shape: Pick<FieldShape, "label" | "control" | "options">): Promise<string> {
  return sha256Hex(`${shape.label}|${shape.control}|${[...shape.options].sort().join(",")}`);
}

export function formFingerprint(shapes: readonly Pick<FieldShape, "label" | "control">[]): Promise<string> {
  const set = Array.from(new Set(shapes.map((s) => `${s.label}|${s.control}`))).sort();
  return sha256Hex(set.join("\n"));
}

export async function signShapes(shapes: readonly FieldShape[]): Promise<SignedShape[]> {
  return Promise.all(
    shapes.map(async (s) => {
      const sig = await fieldSig(s);
      return { ...s, sig, anchor: sig.slice(0, 16) };
    }),
  );
}

/** Denetim sırası → imzalı şema (radyo grubunun her üyesi aynı şemayı gösterir). */
export function sigIndex(signed: readonly SignedShape[]): Map<number, SignedShape> {
  const m = new Map<number, SignedShape>();
  for (const s of signed) for (const i of s.idxs) m.set(i, s);
  return m;
}

/** planFill için: denetim sırası → çapa (16 hex). */
export function anchorIndex(signed: readonly SignedShape[]): Map<number, string> {
  const m = new Map<number, string>();
  for (const s of signed) for (const i of s.idxs) m.set(i, s.anchor);
  return m;
}
