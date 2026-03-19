/**
 * Sync file attachments between miscite and Zotero.
 */
import type { MisciteApiClient, MisciteFile } from "./miscite-api";
import { getKeyMap, setKeyMap, type KeyMap } from "./sync-state";
import { log } from "./utils";

/**
 * Sync files from miscite to Zotero for a given item.
 * Downloads missing files and attaches them to the Zotero parent item.
 */
export async function pullFiles(
  api: MisciteApiClient,
  misciteItemId: number,
  zoteroItem: Zotero.Item,
  libraryID: number,
): Promise<number> {
  const fileKeyMap = getKeyMap("fileKeyMap");
  const response = await api.listItemFiles(misciteItemId);
  const remoteFiles = response.data;
  let downloaded = 0;

  // Get existing attachment hashes for dedup
  const existingHashes = new Set<string>();
  const attachmentIDs = zoteroItem.getAttachments();
  for (const attId of attachmentIDs) {
    const att = Zotero.Items.get(attId);
    if (att) {
      const hash = att.attachmentHash;
      if (hash) existingHashes.add(hash);
    }
  }

  for (const rf of remoteFiles) {
    const mapKey = `m${rf.id}`;
    if (fileKeyMap[mapKey]) continue; // Already synced

    // Check sha256 dedup
    if (rf.sha256 && existingHashes.has(rf.sha256)) {
      fileKeyMap[mapKey] = "dedup";
      continue;
    }

    try {
      const data = await api.downloadFile(rf.id);
      const attachment = await _importAttachment(
        data,
        rf,
        zoteroItem.key,
        libraryID,
      );
      if (attachment) {
        fileKeyMap[mapKey] = attachment.key;
        downloaded++;
        log(`Downloaded file: ${rf.filename} -> ${attachment.key}`);
      }
    } catch (err) {
      log(`Failed to download file ${rf.id}: ${err}`);
    }
  }

  setKeyMap("fileKeyMap", fileKeyMap);
  return downloaded;
}

/**
 * Push new Zotero attachments to miscite for a given item.
 */
export async function pushFiles(
  api: MisciteApiClient,
  misciteItemId: number,
  zoteroItem: Zotero.Item,
): Promise<number> {
  const fileKeyMap = getKeyMap("fileKeyMap");
  const reverseMap: Record<string, string> = {};
  for (const [k, v] of Object.entries(fileKeyMap)) {
    reverseMap[String(v)] = k;
  }

  let uploaded = 0;
  const attachmentIDs = zoteroItem.getAttachments();

  for (const attId of attachmentIDs) {
    const att = Zotero.Items.get(attId);
    if (!att || !att.isAttachment()) continue;

    // Skip if already mapped
    if (reverseMap[att.key]) continue;

    try {
      const filePath = await att.getFilePathAsync();
      if (!filePath) continue;

      // File upload is handled via the API's multipart upload
      // For now, we log and skip - full upload requires FormData with file
      log(
        `Would upload attachment ${att.key} (${filePath}) to miscite item ${misciteItemId}`,
      );
      // TODO: Implement file upload via fetch with FormData
      // const formData = new FormData();
      // formData.append('file', new File([data], att.attachmentFilename));
      // await api.uploadFile(misciteItemId, formData);
    } catch (err) {
      log(`Failed to push file ${att.key}: ${err}`);
    }
  }

  return uploaded;
}

async function _importAttachment(
  data: ArrayBuffer,
  fileInfo: MisciteFile,
  parentKey: string,
  libraryID: number,
): Promise<Zotero.Item | null> {
  // Write data to a temp file
  const tmpDir = Zotero.getTempDirectory();
  const tmpFile = OS.Path.join(tmpDir.path, fileInfo.filename);
  const uint8 = new Uint8Array(data);

  await OS.File.writeAtomic(tmpFile, uint8);

  try {
    const attachment = await Zotero.Attachments.importFromFile({
      file: tmpFile,
      libraryID,
      parentItemID: Zotero.Items.getByLibraryAndKey(libraryID, parentKey)?.id,
      contentType: fileInfo.content_type,
    });
    return attachment;
  } finally {
    // Clean up temp file
    try {
      await OS.File.remove(tmpFile);
    } catch {
      // Ignore cleanup errors
    }
  }
}
