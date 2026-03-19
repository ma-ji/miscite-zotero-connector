/**
 * Sync file attachments between miscite and Zotero.
 */
import type { MisciteApiClient, MisciteFile } from "./miscite-api";
import { getKeyMap, setKeyMap } from "./sync-state";
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
      const hash: string = att.attachmentHash || "";
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
        zoteroItem,
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
  _api: MisciteApiClient,
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
    if (reverseMap[att.key]) continue;

    try {
      const filePath = await att.getFilePathAsync();
      if (!filePath) continue;

      log(
        `Would upload attachment ${att.key} (${filePath}) to miscite item ${misciteItemId}`,
      );
      // TODO: Implement file upload via Zotero.HTTP with multipart body
    } catch (err) {
      log(`Failed to push file ${att.key}: ${err}`);
    }
  }

  return uploaded;
}

async function _importAttachment(
  data: string,
  fileInfo: MisciteFile,
  parentItem: Zotero.Item,
  libraryID: number,
): Promise<Zotero.Item | null> {
  // Write data to a temp file
  const tmpDir = Zotero.getTempDirectory();
  const tmpFile = PathUtils.join(tmpDir.path, fileInfo.filename);

  // Convert string to Uint8Array for writing
  const encoder = new TextEncoder();
  const uint8 = encoder.encode(data);
  await IOUtils.write(tmpFile, uint8);

  try {
    const attachment = await Zotero.Attachments.importFromFile({
      file: tmpFile,
      libraryID,
      parentItemID: parentItem.id,
      contentType: fileInfo.content_type,
    });
    return attachment;
  } finally {
    try {
      await IOUtils.remove(tmpFile);
    } catch {
      // Ignore cleanup errors
    }
  }
}
