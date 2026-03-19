/**
 * Resolve the library and root collection for miscite sync.
 * Uses the user's personal library with a dedicated
 * "miscite.review" collection.
 */
import { getPref, setPref } from "../utils/prefs";
import { log } from "./utils";
import { ensureZoteroCollection } from "./collection-mapper";

const COLLECTION_NAME = "miscite.review";

/**
 * Get the library ID for syncing.
 * Always returns the user's personal library (ID 1).
 */
export async function getGroupLibraryID(): Promise<number> {
  const libraryID = Zotero.Libraries.userLibraryID;

  // Ensure the root "miscite.review" collection exists
  const cached = getPref("groupLibraryId");
  if (!cached || cached <= 0) {
    const colId = await ensureZoteroCollection(libraryID, COLLECTION_NAME);
    if (colId) {
      setPref("groupLibraryId", colId);
      log(
        `Created root collection "${COLLECTION_NAME}"` +
          ` in personal library (col ID: ${colId})`,
      );
    }
  }

  return libraryID;
}

/**
 * Get the root collection ID for miscite items.
 * Items are synced into this collection in the personal library.
 */
export async function getRootCollectionID(): Promise<number> {
  const cached = getPref("groupLibraryId");
  if (cached && cached > 0) {
    // Verify it still exists
    try {
      const col = Zotero.Collections.get(cached);
      if (col) return cached;
    } catch {
      // Collection was deleted
    }
  }

  const libraryID = Zotero.Libraries.userLibraryID;
  const colId = await ensureZoteroCollection(libraryID, COLLECTION_NAME);
  setPref("groupLibraryId", colId);
  return colId;
}
