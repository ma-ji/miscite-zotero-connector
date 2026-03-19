import { SyncEngine } from "./modules/sync-engine";
import { getPref, setPref } from "./modules/sync-state";

let syncEngine: SyncEngine | null = null;
let notifierID: string | false = false;

export function onStartup(): void {
  Zotero.log("[miscite] Plugin started");
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
  Zotero.MisciteConnector.data.initialized = true;
}

export function onMainWindowLoad(window: Window): void {
  const doc = window.document;

  const toolbarButton = doc.createXULElement("toolbarbutton");
  toolbarButton.id = "miscite-sync-button";
  toolbarButton.setAttribute("class", "zotero-tb-button");
  toolbarButton.setAttribute("tooltiptext", "Sync with miscite");
  toolbarButton.setAttribute("label", "miscite Sync");
  toolbarButton.addEventListener("command", () => {
    _triggerSync();
  });

  const toolbar = doc.getElementById("zotero-items-toolbar");
  if (toolbar) {
    toolbar.appendChild(toolbarButton);
  }
}

export function onMainWindowUnload(_window: Window): void {
  // Cleanup handled by shutdown
}

export function onShutdown(): void {
  Zotero.log("[miscite] Plugin shutting down");
  if (notifierID) {
    Zotero.Notifier.unregisterObserver(notifierID);
    notifierID = false;
  }
  const timer = Zotero.MisciteConnector?.data.syncTimer;
  if (timer) {
    globalThis.clearInterval(timer);
    Zotero.MisciteConnector.data.syncTimer = null;
  }
  syncEngine = null;
  Zotero.MisciteConnector.data.alive = false;
}

function _setupAutoSync(): void {
  const enabled = getPref("autoSyncEnabled") as boolean;
  const intervalMin = (getPref("autoSyncInterval") as number) || 15;

  if (!enabled) return;

  const timer = globalThis.setInterval(
    () => {
      _triggerSync();
    },
    intervalMin * 60 * 1000,
  );
  Zotero.MisciteConnector.data.syncTimer = timer;
}

async function _triggerSync(): Promise<void> {
  if (!syncEngine) return;
  try {
    Zotero.log("[miscite] Starting sync...");
    const result = await syncEngine.sync();
    Zotero.log(
      `[miscite] Sync complete: ${result.created} created, ${result.updated} updated, ${result.deleted} deleted`,
    );
    const progressWin = new Zotero.ProgressWindow({ closeOnClick: true });
    progressWin.changeHeadline("miscite Sync");
    progressWin.addDescription(
      `Synced: ${result.created} new, ${result.updated} updated, ${result.deleted} deleted`,
    );
    progressWin.show();
    progressWin.startCloseTimer(4000);
  } catch (err) {
    Zotero.logError(err instanceof Error ? err : new Error(String(err)));
    const progressWin = new Zotero.ProgressWindow({ closeOnClick: true });
    progressWin.changeHeadline("miscite Sync Failed");
    progressWin.addDescription(String(err));
    progressWin.show();
    progressWin.startCloseTimer(6000);
  }
}
