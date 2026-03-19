import { config } from "../package.json";
import { SyncEngine } from "./modules/sync-engine";
import { getPref, setPref } from "./utils/prefs";
import { initLocale, getString } from "./utils/locale";
import { createZToolkit } from "./utils/ztoolkit";
import { registerPrefsScripts } from "./modules/preferences";

let syncEngine: SyncEngine | null = null;
let notifierID: string | false = false;

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();

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
        if (
          event === "delete" &&
          (type === "item" || type === "collection")
        ) {
          const groupLibraryId = getPref("groupLibraryId") as number;
          if (!groupLibraryId) return;
          const deleteQueue = JSON.parse(
            (getPref("deleteQueue") as string) || "[]",
          );
          for (const id of ids) {
            deleteQueue.push({ type, id: String(id), ts: Date.now() });
          }
          setPref("deleteQueue", JSON.stringify(deleteQueue));
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

async function onMainWindowLoad(
  win: _ZoteroTypes.MainWindow,
): Promise<void> {
  addon.data.ztoolkit = createZToolkit();

  win.MozXULElement.insertFTLIfNeeded(
    `${config.addonRef}-addon.ftl`,
  );

  // Add sync toolbar button
  const doc = win.document;
  const toolbarButton = doc.createXULElement("toolbarbutton");
  toolbarButton.id = "miscite-sync-button";
  toolbarButton.setAttribute("class", "zotero-tb-button");
  toolbarButton.setAttribute("tooltiptext", getString("sync-button-tooltip"));
  toolbarButton.setAttribute("label", getString("sync-button-label"));
  toolbarButton.addEventListener("command", () => {
    _triggerSync();
  });

  const toolbar = doc.getElementById("zotero-items-toolbar");
  if (toolbar) {
    toolbar.appendChild(toolbarButton);
  }
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

async function _triggerSync(): Promise<void> {
  if (!syncEngine) return;
  try {
    ztoolkit.log("Starting sync...");
    const result = await syncEngine.sync();
    ztoolkit.log(
      `Sync complete: ${result.created} created, ${result.updated} updated, ${result.deleted} deleted`,
    );
    const progressWin = new ztoolkit.ProgressWindow(
      config.addonName,
      { closeOnClick: true },
    );
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
    const progressWin = new ztoolkit.ProgressWindow(
      config.addonName,
      { closeOnClick: true },
    );
    progressWin
      .createLine({
        text: getString("sync-failed", { args: { error: String(err) } }),
        type: "default",
      })
      .show();
    progressWin.startCloseTimer(6000);
  }
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onPrefsEvent,
};
