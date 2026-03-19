import { getPref, setPref } from "../utils/prefs";

export { getPref, setPref };

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
