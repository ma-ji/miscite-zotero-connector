import { ZoteroToolkit } from "zotero-plugin-toolkit";

export function createZToolkit(): ZoteroToolkit {
  return new ZoteroToolkit();
}

export function log(...args: unknown[]): void {
  Zotero.log(`[miscite] ${args.map(String).join(" ")}`);
}

export function logError(...args: unknown[]): void {
  Zotero.logError(new Error(`[miscite] ${args.map(String).join(" ")}`));
}
