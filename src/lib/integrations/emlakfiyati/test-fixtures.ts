/**
 * YALNIZ TESTLER: açıkça SAHTE anahtar değerleri (gerçek anahtar bu repoda hiçbir yerde yoktur).
 * Önek tek yerde (policy.ts) tanımlıdır; burada ondan türetilir.
 */
import { EMLAKFIYATI_KEY_PREFIX } from "./policy";

export const FAKE_KEY = `${EMLAKFIYATI_KEY_PREFIX}TEST_NOT_REAL_CURRENT_000001`;
export const FAKE_KEY_2 = `${EMLAKFIYATI_KEY_PREFIX}TEST_NOT_REAL_SECOND_000002`;
export const FAKE_ENV_KEY = `${EMLAKFIYATI_KEY_PREFIX}TEST_NOT_REAL_FROM_ENV_0003`;
/** 64 hex = 32 bayt (sahte PLATFORM_SECRETS_KEY). */
export const FAKE_SECRETS_KEY = "ab".repeat(32);
export const FAKE_SECRETS_KEY_OTHER = "cd".repeat(32);

export const ALL_FAKE_KEYS = [FAKE_KEY, FAKE_KEY_2, FAKE_ENV_KEY] as const;
