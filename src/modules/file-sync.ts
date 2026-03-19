/**
 * Sync file attachments between miscite and Zotero.
 */
import type { MisciteApiClient, MisciteFile } from "./miscite-api";
import { getKeyMap, setKeyMap } from "./sync-state";
import { log } from "./utils";

/**
 * Sync files from miscite to Zotero for a given item.
 * Downloads missing files and attaches them to the Zotero
 * parent item.
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

  // Build set of existing local attachment filenames for dedup
  const existingFilenames = new Set<string>();
  for (const attId of zoteroItem.getAttachments()) {
    const att = Zotero.Items.get(attId);
    if (att && att.isAttachment()) {
      try {
        const fp = await att.getFilePathAsync();
        if (fp) existingFilenames.add(PathUtils.filename(fp));
      } catch {
        // ignore
      }
    }
  }

  for (const rf of remoteFiles) {
    const mapKey = `m${rf.id}`;
    if (fileKeyMap[mapKey]) continue; // Already mapped

    // Dedup: skip if a local attachment with the same filename exists
    if (existingFilenames.has(rf.filename)) {
      // Re-establish the mapping without re-downloading
      const attId = zoteroItem.getAttachments().find((id: number) => {
        const att = Zotero.Items.get(id);
        return att?.attachmentFilename === rf.filename;
      });
      if (attId) {
        const att = Zotero.Items.get(attId);
        if (att) {
          fileKeyMap[mapKey] = att.key;
          log(`Re-linked existing file: ${rf.filename} -> ${att.key}`);
        }
      }
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
        log(`Downloaded file: ${rf.filename}` + ` -> ${attachment.key}`);
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

  // Fetch existing remote files for dedup by filename
  let remoteFilenames: Set<string>;
  try {
    const resp = await api.listItemFiles(misciteItemId);
    remoteFilenames = new Set(resp.data.map((f: MisciteFile) => f.filename));
    // Re-establish mappings for any unlinked remote files
    for (const rf of resp.data) {
      const mk = `m${rf.id}`;
      if (!fileKeyMap[mk]) {
        // Find local attachment with matching filename
        const matchId = attachmentIDs.find((id: number) => {
          const a = Zotero.Items.get(id);
          return a?.attachmentFilename === rf.filename;
        });
        if (matchId) {
          const a = Zotero.Items.get(matchId);
          if (a) fileKeyMap[mk] = a.key;
        }
      }
    }
  } catch {
    remoteFilenames = new Set();
  }

  for (const attId of attachmentIDs) {
    const att = Zotero.Items.get(attId);
    if (!att || !att.isAttachment()) continue;
    if (reverseMap[att.key]) continue; // Already mapped

    try {
      const filePath = await att.getFilePathAsync();
      if (!filePath) continue;

      const filename = PathUtils.filename(filePath) || `attachment_${att.key}`;

      // Skip if remote already has a file with the same name
      if (remoteFilenames.has(filename)) {
        log(`Skipping upload of ${filename} — already on server`);
        continue;
      }

      // Read the file content
      const fileData = await IOUtils.read(filePath);
      const contentType =
        att.attachmentContentType || "application/octet-stream";

      log(
        `Uploading attachment ${att.key}` +
          ` (${filename})` +
          ` to miscite item ${misciteItemId}`,
      );
      const response = await api.uploadFile(
        misciteItemId,
        filename,
        contentType,
        fileData,
      );

      if (response.data) {
        fileKeyMap[`m${response.data.id}`] = att.key;
        uploaded++;
        log(
          `Uploaded file: ${filename}` + ` -> miscite file ${response.data.id}`,
        );
      }
    } catch (err) {
      log(`Failed to push file ${att.key}: ${err}`);
    }
  }

  setKeyMap("fileKeyMap", fileKeyMap);
  return uploaded;
}

async function _importAttachment(
  data: Uint8Array,
  fileInfo: MisciteFile,
  parentItem: Zotero.Item,
  libraryID: number,
): Promise<Zotero.Item | null> {
  const tmpDir = Zotero.getTempDirectory();
  const tmpFile = PathUtils.join(tmpDir.path, fileInfo.filename);
  await IOUtils.write(tmpFile, data);

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
