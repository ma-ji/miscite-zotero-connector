/**
 * Maps between miscite path-based collection names
 * and Zotero nested collections.
 * Miscite uses "Parent / Child / Grandchild" paths.
 * Zotero uses nested collection objects with parentCollection
 * references.
 */

const PATH_SEPARATOR = " / ";

/**
 * Find or create a Zotero collection matching a miscite path
 * in the library. Returns the leaf collection ID.
 */
export async function ensureZoteroCollection(
  libraryID: number,
  path: string,
): Promise<number> {
  const segments = path
    .split(PATH_SEPARATOR)
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) {
    throw new Error("Empty collection path");
  }

  let parentKey: string | false = false;

  for (const name of segments) {
    const existing = _findCollection(libraryID, name, parentKey);
    if (existing) {
      parentKey = existing.key;
      continue;
    }

    // Create new collection
    const col = new Zotero.Collection();
    (col as unknown as Record<string, unknown>).libraryID = libraryID;
    col.name = name;
    if (parentKey) {
      col.parentKey = parentKey;
    }
    await col.saveTx();
    parentKey = col.key;
  }

  // Return the ID of the leaf collection
  const leaf = _findCollection(
    libraryID,
    segments[segments.length - 1],
    segments.length > 1
      ? _resolveParentKey(libraryID, segments.slice(0, -1))
      : false,
  );
  return leaf ? leaf.id : 0;
}

function _resolveParentKey(
  libraryID: number,
  segments: string[],
): string | false {
  let parentKey: string | false = false;
  for (const name of segments) {
    const col = _findCollection(libraryID, name, parentKey);
    if (!col) return false;
    parentKey = col.key;
  }
  return parentKey;
}

function _findCollection(
  libraryID: number,
  name: string,
  parentKey: string | false,
): Zotero.Collection | null {
  const collections = Zotero.Collections.getByLibrary(libraryID);
  for (const col of collections) {
    if (
      col.name === name &&
      !(col as any).deleted &&
      (parentKey === false ? !col.parentKey : col.parentKey === parentKey)
    ) {
      return col;
    }
  }
  return null;
}

/**
 * Build a miscite path string from a Zotero collection
 * by walking up the parent chain.
 */
export function zoteroCollectionToPath(collection: Zotero.Collection): string {
  const segments: string[] = [];
  let current: Zotero.Collection | null = collection;

  while (current) {
    segments.unshift(current.name);
    if (current.parentKey) {
      const pKey: string = current.parentKey;
      const libID: number = current.libraryID;
      const allCols: Zotero.Collection[] =
        Zotero.Collections.getByLibrary(libID);
      const found: Zotero.Collection | undefined = allCols.find(
        (c) => c.key === pKey,
      );
      current = found ?? null;
    } else {
      current = null;
    }
  }

  return segments.join(PATH_SEPARATOR);
}
