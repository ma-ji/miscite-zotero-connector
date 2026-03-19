/**
 * Resolve the library and root collection for miscite sync.
 * Uses the user's personal library with a dedicated
 * "miscite.review" collection.
 */
import { getPref, setPref } from "../utils/prefs";
import { log } from "./utils";

const COLLECTION_NAME = "miscite.review";

/**
 * Get the library ID for syncing.
 * Always returns the user's personal library.
 */
export async function getLibraryID(): Promise<number> {
  const libraryID = Zotero.Libraries.userLibraryID;

  // Ensure root collection exists (will scan first, create if needed)
  await getRootCollectionID();

  return libraryID;
}

/**
 * Get the root collection ID for miscite items.
 * Scans existing collections first; creates only if not found.
 */
export async function getRootCollectionID(): Promise<number> {
  // Check cached value
  const cached = getPref("rootCollectionId");
  if (cached && cached > 0) {
    try {
      const col = Zotero.Collections.get(cached);
      if (col && !_isCollectionDeleted(col)) return cached;
    } catch {
      // Collection was deleted, fall through
    }
  }

  const libraryID = Zotero.Libraries.userLibraryID;

  // Scan all local collections for an existing "miscite.review"
  // (skip trashed collections)
  const allCollections = Zotero.Collections.getByLibrary(libraryID);
  for (const col of allCollections) {
    if (
      col.name === COLLECTION_NAME &&
      !col.parentKey &&
      !_isCollectionDeleted(col)
    ) {
      setPref("rootCollectionId", col.id);
      log(
        `Found existing root collection "${COLLECTION_NAME}" (ID: ${col.id})`,
      );
      return col.id;
    }
  }

  // Not found — create it
  const col = new Zotero.Collection();
  (col as unknown as Record<string, unknown>).libraryID = libraryID;
  col.name = COLLECTION_NAME;
  await col.saveTx();
  setPref("rootCollectionId", col.id);
  log(`Created root collection "${COLLECTION_NAME}" (ID: ${col.id})`);
  return col.id;
}

function _isCollectionDeleted(col: Zotero.Collection): boolean {
  try {
    return !!(col as any).deleted;
  } catch {
    return false;
  }
}
