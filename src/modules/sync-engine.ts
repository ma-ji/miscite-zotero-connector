/**
 * Core sync engine: pull from miscite, push from Zotero, handle deletes.
 */
import { MisciteApiClient, type MisciteItem } from "./miscite-api";
import { misciteToZoteroData, zoteroToMisciteData } from "./field-mapper";
import { ensureZoteroCollection } from "./collection-mapper";
import { getGroupLibraryID } from "./group-library";
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
    const libraryID = await getGroupLibraryID();
    const lastSync = (getPref("lastSyncTime") as string) || "";

    const result: SyncResult = {
      created: 0,
      updated: 0,
      deleted: 0,
      errors: 0,
    };

    try {
      // Phase 1: Pull collections from miscite
      await this._pullCollections(api, libraryID, lastSync);

      // Phase 2: Pull items from miscite -> Zotero
      const pullResult = await this._pullItems(api, libraryID, lastSync);
      result.created += pullResult.created;
      result.updated += pullResult.updated;

      // Phase 3: Push items from Zotero -> miscite
      const pushResult = await this._pushItems(api, libraryID, lastSync);
      result.created += pushResult.created;
      result.updated += pushResult.updated;

      // Phase 4: Process delete queue
      const deleteResult = await this._processDeletes(api, libraryID);
      result.deleted += deleteResult;

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

    for (const mc of response.data) {
      const mapKey = `m${mc.id}`;
      if (collectionKeyMap[mapKey]) continue; // Already mapped

      try {
        const colId = await ensureZoteroCollection(libraryID, mc.name);
        if (colId) {
          collectionKeyMap[mapKey] = colId;
        }
      } catch (err) {
        log(`Failed to create collection "${mc.name}": ${err}`);
      }
    }

    setKeyMap("collectionKeyMap", collectionKeyMap);
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
            // Create new Zotero item
            const zItem = await this._createZoteroItem(mi, libraryID);
            if (zItem) {
              itemKeyMap[mapKey] = zItem.key;
              created++;

              // Sync files for new item
              await pullFiles(api, mi.id, zItem, libraryID);
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

    // Get all items in the group library
    const items = await Zotero.Items.getAll(libraryID);
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

  private async _createZoteroItem(
    mi: MisciteItem,
    libraryID: number,
  ): Promise<Zotero.Item | null> {
    const data = misciteToZoteroData(mi);
    const itemTypeID =
      Zotero.ItemTypes.getID(data.itemType as string) ||
      Zotero.ItemTypes.getID("journalArticle");
    const item = new Zotero.Item();
    (item as unknown as Record<string, unknown>).libraryID = libraryID;
    (item as unknown as Record<string, unknown>).itemTypeID = itemTypeID;

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
      if (colZoteroId) {
        const col = Zotero.Collections.get(colZoteroId as number);
        if (col && !col.hasItem(zItem.id)) {
          col.addItem(zItem.id);
          await col.saveTx();
        }
      }
    }
  }
}
