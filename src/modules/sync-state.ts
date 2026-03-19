import { getPref, setPref } from "../utils/prefs";

export { getPref, setPref };

export interface KeyMap {
  [key: string]: string | number;
}

type KeyMapPref = "itemKeyMap" | "collectionKeyMap" | "fileKeyMap";

export function getKeyMap(key: KeyMapPref): KeyMap {
  const raw = getPref(key);
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

export function setKeyMap(key: KeyMapPref, map: KeyMap): void {
  setPref(key, JSON.stringify(map));
}

export function getDeleteQueue(): Array<{
  type: string;
  id: string;
  ts: number;
}> {
  const raw = getPref("deleteQueue");
  try {
    return JSON.parse(raw || "[]");
  } catch {
    return [];
  }
}

export function clearDeleteQueue(): void {
  setPref("deleteQueue", "[]");
}
