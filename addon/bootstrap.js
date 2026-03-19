/* eslint-disable no-undef */
var chromeHandle;

function install(data, reason) {}

async function startup({ id, version, resourceURI, rootURI }, reason) {
  await Zotero.initializationPromise;

  // Register chrome resource
  if (resourceURI) {
    const aomStartup = Components.classes[
      "@mozilla.org/addons/addon-manager-startup;1"
    ].getService(Components.interfaces.amIAddonManagerStartup);
    chromeHandle = aomStartup.registerChrome(resourceURI, [
      ["content", "__addonRef__", "content/"],
    ]);
  }

  // Load main script
  Services.scriptloader.loadSubScript(
    `${rootURI}content/scripts/__addonRef__.js`,
    // eslint-disable-next-line no-undef
    { Zotero, rootURI }
  );

  // Initialize addon
  Zotero.__addonInstance__.hooks.onStartup();
}

function onMainWindowLoad({ window }) {
  Zotero.__addonInstance__.hooks.onMainWindowLoad(window);
}

function onMainWindowUnload({ window }) {
  Zotero.__addonInstance__.hooks.onMainWindowUnload(window);
}

function shutdown({ id, version, resourceURI, rootURI }, reason) {
  if (reason === APP_SHUTDOWN) return;
  Zotero.__addonInstance__?.hooks.onShutdown();
  // Unregister chrome
  chromeHandle?.destruct();
  chromeHandle = null;
}

function uninstall(data, reason) {}
