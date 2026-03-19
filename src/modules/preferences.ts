import { MisciteApiClient } from "./miscite-api";
import { getString } from "../utils/locale";
import { config } from "../../package.json";

export function registerPrefsScripts(_win: Window): void {
  const doc = _win.document;

  // Wire up test connection button
  const testBtn = doc.getElementById(
    `zotero-prefpane-${config.addonRef}-test-connection`,
  );
  if (testBtn) {
    testBtn.addEventListener("command", () => {
      onTestConnection();
    });
  }

  // Wire up sync now button
  const syncBtn = doc.getElementById(
    `zotero-prefpane-${config.addonRef}-sync-now`,
  );
  if (syncBtn) {
    syncBtn.addEventListener("command", () => {
      addon.hooks.onPrefsEvent("sync", {});
    });
  }

  // Wire up full re-sync button
  const fullSyncBtn = doc.getElementById(
    `zotero-prefpane-${config.addonRef}-full-resync`,
  );
  if (fullSyncBtn) {
    fullSyncBtn.addEventListener("command", () => {
      addon.hooks.onPrefsEvent("fullSync", {});
    });
  }
}

async function onTestConnection(): Promise<void> {
  try {
    const api = new MisciteApiClient();
    const result = await api.testConnection();
    ztoolkit.log(`Connection successful: ${result.email}`);

    Services.prompt.alert(
      Services.wm.getMostRecentWindow("navigator:browser"),
      getString("connection-success-title"),
      getString("connection-success-message", {
        args: { email: result.email },
      }),
    );
  } catch (err) {
    ztoolkit.log(`Connection test failed: ${err}`);

    Services.prompt.alert(
      Services.wm.getMostRecentWindow("navigator:browser"),
      getString("connection-failed-title"),
      getString("connection-failed-message", {
        args: { error: String(err) },
      }),
    );
  }
}
