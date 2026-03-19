import { Addon } from "./addon";

// Prevent duplicate initialization
if (!Zotero.MisciteConnector) {
  const addon = new Addon();
  Zotero.MisciteConnector = addon;

  // Expose ztoolkit globally for convenience
  Object.defineProperty(Zotero, "ztoolkit", {
    get() {
      return addon.data.ztoolkit;
    },
  });
}
