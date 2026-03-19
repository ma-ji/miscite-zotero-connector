/**
 * Core sync engine: pull from miscite, push from Zotero, handle deletes.
 */
import { MisciteApiClient, type MisciteItem } from "./miscite-api";
import { misciteToZoteroData, zoteroToMisciteData } from "./field-mapper";
import { getLibraryID, getRootCollectionID } from "./library";
import { pullFiles, pushFiles } from "./file-sync";
import {
  getPref,
  setPref,
  getKeyMap,
  setKeyMap,
  getDeleteQueue,
  clearDeleteQueue,
} from "./sync-state";
import { log } from "./utils";

export interface SyncResult {
  created: number;
  updated: number;
  deleted: number;
  errors: number;
}

export class SyncEngine {
  async sync(): Promise<SyncResult> {
    const api = new MisciteApiClient();

    // Verify connection first
    log("Testing API connection...");
    const me = await api.testConnection();
    log(`Authenticated as: ${me.email}`);

    const libraryID = await getLibraryID();
    log(`Using library ID: ${libraryID}`);

    const lastSync = (getPref("lastSyncTime") as string) || "";
    log(`Last sync: ${lastSync || "(first sync)"}`);

    const result: SyncResult = {
      created: 0,
      updated: 0,
      deleted: 0,
      errors: 0,
    };

    try {
      // Phase 1: Pull collections from miscite
      log("Phase 1: Pulling collections...");
      await this._pullCollections(api, libraryID, lastSync);

      // Phase 2: Pull items from miscite -> Zotero
      log("Phase 2: Pulling items...");
      const pullResult = await this._pullItems(api, libraryID, lastSync);
      result.created += pullResult.created;
      result.updated += pullResult.updated;
      log(`Pull: ${pullResult.created} created, ${pullResult.updated} updated`);

      // Phase 3: Push items from Zotero -> miscite
      log("Phase 3: Pushing items...");
      const pushResult = await this._pushItems(api, libraryID, lastSync);
      result.created += pushResult.created;
      result.updated += pushResult.updated;
      log(`Push: ${pushResult.created} created, ${pushResult.updated} updated`);

      // Phase 4: Process delete queue
      log("Phase 4: Processing deletes...");
      const deleteResult = await this._processDeletes(api, libraryID);
      result.deleted += deleteResult;
      log(`Deletes: ${deleteResult}`);

      // Update last sync time from server
      const timeCheck = await api.listItems();
      setPref("lastSyncTime", timeCheck.server_time);
    } catch (err) {
      result.errors++;
      throw err;
    }

    return result;
  }

  private async _pullCollections(
    api: MisciteApiClient,
    libraryID: number,
    since: string,
  ): Promise<void> {
    const response = await api.listCollections(since || undefined);
    const collectionKeyMap = getKeyMap("collectionKeyMap");
    const rootColId = await getRootCollectionID();

    log(
      `Collections: ${response.data.length} from server,` +
        ` ${Object.keys(collectionKeyMap).length} in keymap`,
    );

    for (const mc of response.data) {
      const mapKey = `m${mc.id}`;
      if (collectionKeyMap[mapKey]) continue; // Already mapped

      try {
        // Create sub-collections under the miscite root collection
        const rootCol = Zotero.Collections.get(rootColId);
        const parentKey = rootCol ? rootCol.key : false;
        const colId = await this._ensureChildCollection(
          libraryID,
          mc.name,
          parentKey,
        );
        if (colId) {
          collectionKeyMap[mapKey] = colId;
          log(`Mapped collection "${mc.name}" (m${mc.id} -> ${colId})`);
        }
      } catch (err) {
        log(`Failed to create collection "${mc.name}": ${err}`);
      }
    }

    setKeyMap("collectionKeyMap", collectionKeyMap);
  }

  private async _ensureChildCollection(
    libraryID: number,
    name: string,
    parentKey: string | false,
  ): Promise<number> {
    // Search for existing collection with this name under the parent
    // (skip trashed collections)
    const collections = Zotero.Collections.getByLibrary(libraryID);
    for (const col of collections) {
      if (
        col.name === name &&
        !(col as any).deleted &&
        (parentKey === false ? !col.parentKey : col.parentKey === parentKey)
      ) {
        return col.id;
      }
    }

    // Create new collection under the parent
    const col = new Zotero.Collection();
    (col as unknown as Record<string, unknown>).libraryID = libraryID;
    col.name = name;
    if (parentKey) {
      col.parentKey = parentKey;
    }
    await col.saveTx();
    return col.id;
  }

  private async _pullItems(
    api: MisciteApiClient,
    libraryID: number,
    since: string,
  ): Promise<{ created: number; updated: number }> {
    let created = 0;
    let updated = 0;
    let hasMore = true;
    let offset = 0;
    const itemKeyMap = getKeyMap("itemKeyMap");

    while (hasMore) {
      const sinceParam = since || undefined;
      const response = await api.listItems(sinceParam, offset);
      hasMore = response.has_more;
      log(
        `API returned ${response.data.length} items` +
          ` (offset=${offset}, has_more=${hasMore})`,
      );

      for (const mi of response.data) {
        try {
          const mapKey = `m${mi.id}`;
          const existingKey = itemKeyMap[mapKey] as string | undefined;

          if (existingKey) {
            // Update existing Zotero item
            const zItem = Zotero.Items.getByLibraryAndKey(
              libraryID,
              existingKey,
            );
            if (zItem) {
              const serverDate = new Date(mi.updated_at);
              const zoteroDate = new Date(zItem.dateModified);
              if (serverDate > zoteroDate) {
                await this._updateZoteroItem(zItem, mi);
                updated++;
              }
            }
          } else {
            // Check for existing duplicate by DOI or title
            const existing = await this._findExistingItem(mi, libraryID);
            if (existing) {
              // Link to the existing item instead of creating a duplicate
              itemKeyMap[mapKey] = existing.key;
              log(
                `Linked miscite item ${mi.id} to existing` +
                  ` Zotero item "${mi.title}" (${existing.key})`,
              );

              // Add to miscite root collection if not already there
              const rootColId = await getRootCollectionID();
              if (rootColId) {
                const rootCol = Zotero.Collections.get(rootColId);
                if (rootCol && !rootCol.hasItem(existing.id)) {
                  rootCol.addItem(existing.id);
                  await rootCol.saveTx();
                }
              }
            } else {
              // Create new Zotero item
              const zItem = await this._createZoteroItem(mi, libraryID);
              if (zItem) {
                itemKeyMap[mapKey] = zItem.key;
                created++;

                // Sync files for new item
                await pullFiles(api, mi.id, zItem, libraryID);
              }
            }
          }

          // Sync collection memberships
          await this._syncItemCollections(
            mi,
            itemKeyMap[mapKey] as string,
            libraryID,
          );
        } catch (err) {
          log(`Failed to pull item ${mi.id} "${mi.title}": ${err}`);
        }
      }

      offset += response.data.length;
      if (!hasMore) break;
    }

    setKeyMap("itemKeyMap", itemKeyMap);
    return { created, updated };
  }

  private async _pushItems(
    api: MisciteApiClient,
    libraryID: number,
    since: string,
  ): Promise<{ created: number; updated: number }> {
    let created = 0;
    let updated = 0;
    const itemKeyMap = getKeyMap("itemKeyMap");

    // Build reverse map: zotero_key -> miscite_id
    const reverseMap: Record<string, number> = {};
    for (const [k, v] of Object.entries(itemKeyMap)) {
      if (k.startsWith("m")) {
        reverseMap[String(v)] = parseInt(k.slice(1), 10);
      }
    }

    // Get items in the miscite root collection only
    const rootColId = await getRootCollectionID();
    const rootCol = rootColId ? Zotero.Collections.get(rootColId) : null;
    if (!rootCol) return { created, updated };

    const itemIDs = rootCol.getChildItems(true);
    const items = itemIDs
      .map((id: number) => Zotero.Items.get(id))
      .filter(Boolean);
    const sinceDate = since ? new Date(since) : new Date(0);

    for (const zItem of items) {
      if (!zItem.isRegularItem()) continue;

      const modified = new Date(zItem.dateModified);
      if (modified <= sinceDate) continue;

      const misciteId = reverseMap[zItem.key];
      const data = zoteroToMisciteData(zItem);

      try {
        if (misciteId) {
          // Update existing miscite item if Zotero is newer
          await api.updateItem(misciteId, data);
          updated++;

          // Push files
          await pushFiles(api, misciteId, zItem);
        } else {
          // Create new miscite item
          const response = await api.createItem(data as MisciteItem);
          const newItem = response.data;
          itemKeyMap[`m${newItem.id}`] = zItem.key;
          created++;

          // Push files
          await pushFiles(api, newItem.id, zItem);
        }
      } catch (err) {
        log(`Failed to push item "${zItem.getField("title")}": ${err}`);
      }
    }

    setKeyMap("itemKeyMap", itemKeyMap);
    return { created, updated };
  }

  private async _processDeletes(
    api: MisciteApiClient,
    _libraryID: number,
  ): Promise<number> {
    const deleteQueue = getDeleteQueue();
    if (deleteQueue.length === 0) return 0;

    const itemKeyMap = getKeyMap("itemKeyMap");
    let deleted = 0;

    for (const entry of deleteQueue) {
      try {
        if (entry.type === "item") {
          // The delete notifier gives us a Zotero item ID (numeric).
          // We need to find which miscite ID maps to a Zotero key that
          // corresponds to this deleted item. Since the item is deleted,
          // we search the keymap for any entry whose value matches.
          let misciteId: number | null = null;
          for (const [k, v] of Object.entries(itemKeyMap)) {
            if (String(v) === entry.id && k.startsWith("m")) {
              misciteId = parseInt(k.slice(1), 10);
              delete itemKeyMap[k];
              break;
            }
          }
          if (misciteId) {
            await api.deleteItem(misciteId);
            deleted++;
          }
        } else if (entry.type === "collection") {
          const collectionKeyMap = getKeyMap("collectionKeyMap");
          let misciteId: number | null = null;
          for (const [k, v] of Object.entries(collectionKeyMap)) {
            if (String(v) === entry.id && k.startsWith("m")) {
              misciteId = parseInt(k.slice(1), 10);
              delete collectionKeyMap[k];
              break;
            }
          }
          if (misciteId) {
            await api.deleteCollection(misciteId);
            deleted++;
          }
          setKeyMap("collectionKeyMap", collectionKeyMap);
        }
      } catch (err) {
        log(`Failed to process delete for ${entry.type} ${entry.id}: ${err}`);
      }
    }

    setKeyMap("itemKeyMap", itemKeyMap);
    clearDeleteQueue();
    return deleted;
  }

  /**
   * Find an existing Zotero item matching a miscite item by DOI.
   * Returns null if no DOI or no match found.
   */
  private async _findExistingItem(
    mi: MisciteItem,
    libraryID: number,
  ): Promise<Zotero.Item | null> {
    if (!mi.doi) return null;

    try {
      const s = new Zotero.Search();
      s.addCondition("libraryID", "is", String(libraryID));
      s.addCondition("DOI", "is", mi.doi);
      const ids = await s.search();
      for (const id of ids) {
        const item = Zotero.Items.get(id);
        if (!item || !item.isRegularItem()) continue;
        // Skip items in trash
        if (item.deleted) continue;
        return item;
      }
    } catch (err) {
      log(`DOI search failed for "${mi.doi}": ${err}`);
    }

    return null;
  }

  private async _createZoteroItem(
    mi: MisciteItem,
    libraryID: number,
  ): Promise<Zotero.Item | null> {
    const data = misciteToZoteroData(mi);
    const itemType = (data.itemType as string) || "journalArticle";
    const item = new Zotero.Item(
      itemType as ConstructorParameters<typeof Zotero.Item>[0],
    );
    (item as unknown as Record<string, unknown>).libraryID = libraryID;

    // Set fields
    for (const [field, value] of Object.entries(data)) {
      if (field === "itemType" || field === "creators") continue;
      try {
        item.setField(field, value as string);
      } catch {
        // Field may not be valid for this item type
      }
    }

    // Set creators
    if (Array.isArray(data.creators)) {
      item.setCreators(
        data.creators as Parameters<Zotero.Item["setCreators"]>[0],
      );
    }

    await item.saveTx();
    log(`Created Zotero item: "${mi.title}" -> ${item.key}`);

    // Add item to the root miscite collection
    const rootColId = await getRootCollectionID();
    if (rootColId) {
      const rootCol = Zotero.Collections.get(rootColId);
      if (rootCol && !rootCol.hasItem(item.id)) {
        rootCol.addItem(item.id);
        await rootCol.saveTx();
      }
    }

    // Add note if miscite item has notes
    if (mi.notes) {
      const note = new Zotero.Item("note");
      (note as unknown as Record<string, unknown>).libraryID = libraryID;
      note.parentKey = item.key;
      note.setNote(mi.notes);
      await note.saveTx();
    }

    return item;
  }

  private async _updateZoteroItem(
    zItem: Zotero.Item,
    mi: MisciteItem,
  ): Promise<void> {
    const data = misciteToZoteroData(mi);

    for (const [field, value] of Object.entries(data)) {
      if (field === "itemType" || field === "creators") continue;
      try {
        zItem.setField(field, value as string);
      } catch {
        // Field may not be valid
      }
    }

    if (Array.isArray(data.creators)) {
      zItem.setCreators(
        data.creators as Parameters<Zotero.Item["setCreators"]>[0],
      );
    }

    await zItem.saveTx();
    log(`Updated Zotero item: "${mi.title}"`);
  }

  private async _syncItemCollections(
    mi: MisciteItem,
    zoteroKey: string,
    libraryID: number,
  ): Promise<void> {
    if (!mi.collection_ids || mi.collection_ids.length === 0) return;

    const zItem = Zotero.Items.getByLibraryAndKey(libraryID, zoteroKey);
    if (!zItem) return;

    const collectionKeyMap = getKeyMap("collectionKeyMap");

    for (const mcId of mi.collection_ids) {
      const colZoteroId = collectionKeyMap[`m${mcId}`];
      if (!colZoteroId) {
        log(`No local collection mapped for miscite collection ${mcId}`);
        continue;
      }
      const col = Zotero.Collections.get(colZoteroId as number);
      if (col && !col.hasItem(zItem.id)) {
        col.addItem(zItem.id);
        await col.saveTx();
      }
    }
  }
}
