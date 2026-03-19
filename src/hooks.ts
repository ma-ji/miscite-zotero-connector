import { config } from "../package.json";
import { SyncEngine } from "./modules/sync-engine";
import { getPref, setPref } from "./utils/prefs";
import { initLocale, getString } from "./utils/locale";
import { createZToolkit } from "./utils/ztoolkit";
import { registerPrefsScripts } from "./modules/preferences";

let syncEngine: SyncEngine | null = null;
let notifierID: string | false = false;
let syncInProgress = false;

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();

  // Register preferences pane in Zotero Settings
  Zotero.PreferencePanes.register({
    pluginID: config.addonID,
    src: rootURI + "content/preferences.xhtml",
    label: getString("prefs-title"),
  });

  syncEngine = new SyncEngine();

  // Register notifier to track deletions
  notifierID = Zotero.Notifier.registerObserver(
    {
      notify(
        event: string,
        type: string,
        ids: (string | number)[],
        _extraData: Record<string, unknown>,
      ) {
        if (event === "delete" && (type === "item" || type === "collection")) {
          // For items: extraData contains {[id]: {key}} for deleted items.
          // For collections: Zotero passes numeric IDs which match our map values.
          const keyMap = JSON.parse(
            (getPref(
              type === "item" ? "itemKeyMap" : "collectionKeyMap",
            ) as string) || "{}",
          );
          const deleteQueue = JSON.parse(
            (getPref("deleteQueue") as string) || "[]",
          );
          // Build reverse: value -> miscite map key
          const reverseByValue: Record<string, string> = {};
          for (const [mk, v] of Object.entries(keyMap)) {
            reverseByValue[String(v)] = mk;
          }

          let changed = false;
          for (const id of ids) {
            let matchKey: string | undefined;
            if (type === "item") {
              // Notifier gives numeric ID; extraData has the Zotero key
              const extra = _extraData[String(id)] as
                | { key?: string }
                | undefined;
              const zoteroKey = extra?.key;
              if (zoteroKey) {
                matchKey = reverseByValue[zoteroKey];
              }
            } else {
              // Collection: numeric ID matches our map values directly
              matchKey = reverseByValue[String(id)];
            }
            if (matchKey) {
              deleteQueue.push({
                type,
                // Store the miscite map key (e.g. "m123") for _processDeletes
                id: matchKey,
                ts: Date.now(),
              });
              changed = true;
            }
          }
          if (changed) {
            setPref("deleteQueue", JSON.stringify(deleteQueue));
          }
        }
      },
    },
    ["item", "collection"],
    "miscite-connector",
  );

  _setupAutoSync();

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  addon.data.initialized = true;
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  addon.data.ztoolkit = createZToolkit();

  win.MozXULElement.insertFTLIfNeeded(`${config.addonRef}-addon.ftl`);
}

async function onMainWindowUnload(_win: Window): Promise<void> {
  ztoolkit.unregisterAll();
}

function onShutdown(): void {
  ztoolkit.unregisterAll();

  if (notifierID) {
    Zotero.Notifier.unregisterObserver(notifierID);
    notifierID = false;
  }

  const timer = addon.data.syncTimer;
  if (timer) {
    Zotero.getMainWindow()?.clearInterval(timer);
    addon.data.syncTimer = null;
  }

  syncEngine = null;
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[config.addonInstance];
}

async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  switch (type) {
    case "load":
      registerPrefsScripts(data.window);
      break;
    case "sync":
      await _triggerSync();
      break;
    case "fullSync":
      await _resetAndSync();
      break;
    default:
      return;
  }
}

function _setupAutoSync(): void {
  const enabled = getPref("autoSyncEnabled") as boolean;
  const intervalMin = (getPref("autoSyncInterval") as number) || 15;

  if (!enabled) return;

  const win = Zotero.getMainWindow();
  if (!win) return;
  const timer = win.setInterval(
    () => {
      _triggerSync();
    },
    intervalMin * 60 * 1000,
  );
  addon.data.syncTimer = timer;
}

async function _resetAndSync(): Promise<void> {
  ztoolkit.log("Resetting sync state for full re-sync...");
  setPref("lastSyncTime", "");
  setPref("itemKeyMap", "{}");
  setPref("collectionKeyMap", "{}");
  setPref("fileKeyMap", "{}");
  setPref("deleteQueue", "[]");
  await _triggerSync();
}

async function _triggerSync(): Promise<void> {
  if (!syncEngine) return;
  if (syncInProgress) {
    ztoolkit.log("Sync already in progress, skipping.");
    return;
  }
  syncInProgress = true;
  try {
    ztoolkit.log("Starting sync...");
    const result = await syncEngine.sync();
    ztoolkit.log(
      `Sync complete: ${result.created} created, ` +
        `${result.updated} updated, ` +
        `${result.deleted} deleted`,
    );
    const progressWin = new ztoolkit.ProgressWindow(config.addonName, {
      closeOnClick: true,
    });
    progressWin
      .createLine({
        text: getString("sync-complete", {
          args: {
            created: result.created,
            updated: result.updated,
            deleted: result.deleted,
          },
        }),
        type: "default",
      })
      .show();
    progressWin.startCloseTimer(4000);
  } catch (err) {
    Zotero.logError(err instanceof Error ? err : new Error(String(err)));
    const progressWin = new ztoolkit.ProgressWindow(config.addonName, {
      closeOnClick: true,
    });
    progressWin
      .createLine({
        text: getString("sync-failed", {
          args: { error: String(err) },
        }),
        type: "default",
      })
      .show();
    progressWin.startCloseTimer(6000);
  } finally {
    syncInProgress = false;
  }
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onPrefsEvent,
};
