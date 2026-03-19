// Re-export from centralized utilities for backward compatibility
export { createZToolkit } from "../utils/ztoolkit";

export function log(...args: unknown[]): void {
  ztoolkit.log(...args);
}

export function logError(...args: unknown[]): void {
  const msg = `[${addon.data.config.addonName}] ${args.map(String).join(" ")}`;
  Zotero.logError(new Error(msg));
}
