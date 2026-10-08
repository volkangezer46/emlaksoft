import { isOutdated } from "./extension-release";

/**
 * KURULUM SİHİRBAZI KARARI (SAF, testli). Uygulama içi sayfa eklentiyi belge köküne konan işaretlerden ALGILAR (kurulu mu,
 * sürümü güncel mi, bağlı mı, duraklatıldı mı) ve hangi adımın aktif olduğunu buradan alır.
 */

export type WizardInput = {
  installed: boolean;
  installedVersion: string | null;
  connected: boolean;
  paused: boolean;
  latestVersion: string;
};

export type WizardStage = "install" | "update" | "connect" | "paused" | "ready";

export type WizardView = {
  stage: WizardStage;
  /** Üç adım: indir → tarayıcıya yükle → bağla. */
  steps: { download: boolean; load: boolean; connect: boolean };
  outdated: boolean;
};

export function wizardView(i: WizardInput): WizardView {
  const outdated = i.installed && isOutdated(i.installedVersion, i.latestVersion);
  const steps = { download: i.installed, load: i.installed, connect: i.installed && i.connected };
  let stage: WizardStage;
  if (!i.installed) stage = "install";
  else if (outdated) stage = "update";
  else if (!i.connected) stage = "connect";
  else if (i.paused) stage = "paused";
  else stage = "ready";
  return { stage, steps, outdated };
}
