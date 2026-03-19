const PREF_PREFIX = "extensions.miscite-connector";

export function getPref(key: string): string | number | boolean {
  return Zotero.Prefs.get(`${PREF_PREFIX}.${key}`, true) as
    | string
    | number
    | boolean;
}

export function setPref(key: string, value: string | number | boolean): void {
  Zotero.Prefs.set(`${PREF_PREFIX}.${key}`, value, true);
}

export interface KeyMap {
  [key: string]: string | number;
}

export function getKeyMap(key: string): KeyMap {
  const raw = getPref(key) as string;
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

export function setKeyMap(key: string, map: KeyMap): void {
  setPref(key, JSON.stringify(map));
}

export function getDeleteQueue(): Array<{
  type: string;
  id: string;
  ts: number;
}> {
  const raw = getPref("deleteQueue") as string;
  try {
    return JSON.parse(raw || "[]");
  } catch {
    return [];
  }
}

export function clearDeleteQueue(): void {
  setPref("deleteQueue", "[]");
}
