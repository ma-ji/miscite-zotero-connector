import { config } from "../package.json";
import { SyncEngine } from "./modules/sync-engine";
import { isSuppressDeleteNotifier } from "./modules/sync-state";
import { getPref, setPref } from "./utils/prefs";
import { initLocale, getString } from "./utils/locale";
import { createZToolkit } from "./utils/ztoolkit";
import { registerPrefsScripts } from "./modules/preferences";

let syncEngine: SyncEngine | null = null;
let notifierID: string | false = false;
let prefObserverIDs: symbol[] = [];
let syncInProgress = false;
let consecutiveAuthFailures = 0;

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

  // Register notifier to track deletions and trashing
  notifierID = Zotero.Notifier.registerObserver(
    {
      notify(
        event: string,
        type: string,
        ids: (string | number)[],
        _extraData: Record<string, unknown>,
      ) {
        if (
          (event === "delete" || event === "trash") &&
          (type === "item" || type === "collection") &&
          !isSuppressDeleteNotifier()
        ) {
          // For delete: extraData contains {[id]: {key}} for deleted items.
          // For trash: item still exists in DB, look up key directly.
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
              let zoteroKey: string | undefined;
              if (event === "delete") {
                // Notifier gives numeric ID; extraData has the Zotero key
                const extra = _extraData[String(id)] as
                  | { key?: string }
                  | undefined;
                zoteroKey = extra?.key;
              } else {
                // Trash: item still exists, look up directly
                try {
                  const zItem = Zotero.Items.get(id as number);
                  zoteroKey = zItem?.key;
                } catch {
                  // Item lookup failed
                }
              }
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

  // Watch for auto-sync pref changes so toggling or changing interval
  // takes effect immediately without restarting Zotero
  prefObserverIDs.push(
    Zotero.Prefs.registerObserver(
      `${config.prefsPrefix}.autoSyncEnabled`,
      () => _setupAutoSync(),
      true,
    ),
    Zotero.Prefs.registerObserver(
      `${config.prefsPrefix}.autoSyncInterval`,
      () => _setupAutoSync(),
      true,
    ),
    Zotero.Prefs.registerObserver(
      `${config.prefsPrefix}.apiToken`,
      () => _setupAutoSync(),
      true,
    ),
  );

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  addon.data.initialized = true;

  // Run an initial sync shortly after startup (if auto-sync is enabled
  // and credentials are configured) so the user doesn't have to wait
  // for the first interval to fire.
  if (getPref("autoSyncEnabled") && getPref("apiToken")) {
    Zotero.getMainWindow()?.setTimeout(() => _triggerSync(), 5000);
  }
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

  for (const sym of prefObserverIDs) {
    Zotero.Prefs.unregisterObserver(sym);
  }
  prefObserverIDs = [];

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
  // Clear any existing timer first so toggling/changing interval works
  const win = Zotero.getMainWindow();
  if (addon.data.syncTimer) {
    win?.clearInterval(addon.data.syncTimer);
    addon.data.syncTimer = null;
  }

  const enabled = getPref("autoSyncEnabled") as boolean;
  const intervalMin = (getPref("autoSyncInterval") as number) || 15;

  if (!enabled) return;

  // Reset auth-failure counter when auto-sync is (re-)enabled so the
  // user gets a full 3 retry attempts after fixing their token.
  consecutiveAuthFailures = 0;
  if (!getPref("apiToken")) return; // no token → no point syncing
  if (!win) return;

  const timer = win.setInterval(
    () => {
      _triggerSync();
    },
    intervalMin * 60 * 1000,
  );
  addon.data.syncTimer = timer;
  ztoolkit.log(
    `Auto sync enabled: every ${intervalMin} minutes`,
  );
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
    consecutiveAuthFailures = 0; // reset on success
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
  } catch (err: any) {
    Zotero.logError(err instanceof Error ? err : new Error(String(err)));

    // Detect auth failures (401/403) and disable auto-sync after 3
    // consecutive failures to avoid spamming error popups every interval
    const status = err?.status ?? err?.xmlhttp?.status;
    if (status === 401 || status === 403) {
      consecutiveAuthFailures++;
      if (consecutiveAuthFailures >= 3) {
        ztoolkit.log(
          "Disabling auto-sync after repeated auth failures." +
            " Check your API token in settings.",
        );
        setPref("autoSyncEnabled", false);
        _setupAutoSync(); // clear the timer
      }
    }

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
