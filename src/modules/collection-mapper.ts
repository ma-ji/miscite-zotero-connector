/**
 * Maps between miscite path-based collection names and Zotero nested collections.
 * Miscite uses "Parent / Child / Grandchild" paths.
 * Zotero uses nested collection objects with parentCollection references.
 */

const PATH_SEPARATOR = " / ";

/**
 * Find or create a Zotero collection matching a miscite path in the group library.
 * Returns the leaf collection ID.
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
    // Search for existing collection at this level
    const existing = _findCollection(libraryID, name, parentKey);
    if (existing) {
      parentKey = existing.key;
      continue;
    }

    // Create new collection
    const col = new Zotero.Collection();
    col.libraryID = libraryID;
    col.name = name;
    if (parentKey) {
      col.parentKey = parentKey;
    }
    await col.saveTx();
    parentKey = col.key;
  }

  // Return the collection ID of the leaf
  const leaf = _findCollection(libraryID, segments[segments.length - 1], parentKey === false ? false : _parentOfLeaf(libraryID, segments));
  return leaf ? leaf.id : 0;
}

function _parentOfLeaf(libraryID: number, segments: string[]): string | false {
  if (segments.length <= 1) return false;
  let parentKey: string | false = false;
  for (let i = 0; i < segments.length - 1; i++) {
    const col = _findCollection(libraryID, segments[i], parentKey);
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
      (parentKey === false
        ? !col.parentKey
        : col.parentKey === parentKey)
    ) {
      return col;
    }
  }
  return null;
}

/**
 * Build a miscite path string from a Zotero collection by walking up the parent chain.
 */
export function zoteroCollectionToPath(
  collection: Zotero.Collection,
): string {
  const segments: string[] = [];
  let current: Zotero.Collection | null = collection;

  while (current) {
    segments.unshift(current.name);
    if (current.parentKey) {
      const parent = Zotero.Collections.getByLibrary(current.libraryID).find(
        (c: Zotero.Collection) => c.key === current!.parentKey,
      );
      current = parent || null;
    } else {
      current = null;
    }
  }

  return segments.join(PATH_SEPARATOR);
}
