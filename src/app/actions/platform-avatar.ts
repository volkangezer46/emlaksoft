"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformStaff } from "@/lib/platform";
import { clearOwnAvatar, storeOwnAvatar, storeOwnPreset, type AvatarResult } from "@/lib/avatar-server";

/** Platform personelinin KENDİ avatarı (hedef daima oturumdaki personel; kova öneki `platform`). */
function refresh() {
  revalidatePath("/admin", "layout");
}

export async function uploadStaffAvatar(fd: FormData): Promise<AvatarResult> {
  const staff = await requirePlatformStaff();
  const res = await storeOwnAvatar(await createClient(), "platform", staff.id, fd);
  if (res.ok) refresh();
  return res;
}

export async function setStaffAvatarPreset(preset: string): Promise<AvatarResult> {
  const staff = await requirePlatformStaff();
  const res = await storeOwnPreset(await createClient(), "platform", staff.id, preset);
  if (res.ok) refresh();
  return res;
}

export async function removeStaffAvatar(): Promise<AvatarResult> {
  const staff = await requirePlatformStaff();
  const res = await clearOwnAvatar(await createClient(), "platform", staff.id);
  if (res.ok) refresh();
  return res;
}
