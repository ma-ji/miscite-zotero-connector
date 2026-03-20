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

/**
 * Flag to suppress Notifier delete-queue entries during sync-initiated
 * trashes (tombstone processing).  The sync engine sets this to true
 * before trashing items that were deleted on the server, preventing
 * the Notifier from queueing redundant delete entries.
 */
let _suppressDeleteNotifier = false;
export function setSuppressDeleteNotifier(v: boolean): void {
  _suppressDeleteNotifier = v;
}
export function isSuppressDeleteNotifier(): boolean {
  return _suppressDeleteNotifier;
}
