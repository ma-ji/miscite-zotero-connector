import { config } from "../../package.json";

const PREFS_PREFIX = config.prefsPrefix;

export function getPref(key: string): string | number | boolean {
  return Zotero.Prefs.get(`${PREFS_PREFIX}.${key}`, true) as
    | string
    | number
    | boolean;
}

export function setPref(key: string, value: string | number | boolean): void {
  Zotero.Prefs.set(`${PREFS_PREFIX}.${key}`, value, true);
}

export function clearPref(key: string): void {
  Zotero.Prefs.clear(`${PREFS_PREFIX}.${key}`, true);
}
