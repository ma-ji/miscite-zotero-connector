/**
 * Sync file attachments between miscite and Zotero.
 *
 * Deduplication strategy:
 * - Pull: match by SHA256 first, then by filename.  This prevents
 *   re-downloading identical content even after a full re-sync (when
 *   keymap is cleared) or when filenames differ.
 * - Push: match by SHA256 first (server returns hashes), then by
 *   filename. The server also does SHA256 dedup on upload as a safety
 *   net, but avoiding the upload entirely saves bandwidth.
 */
import type { MisciteApiClient, MisciteFile } from "./miscite-api";
import { getKeyMap, setKeyMap } from "./sync-state";
import { log } from "./utils";

/**
 * Compute SHA-256 hex digest of a Uint8Array using the Mozilla
 * nsICryptoHash XPCOM component available in the Zotero environment.
 */
function sha256hex(data: Uint8Array): string {
  // Use nsICryptoHash via XPCOM — available in the Zotero/Gecko env
  const hashComp = (Components.classes as Record<string, any>)[
    "@mozilla.org/security/hash;1"
  ];
  const ch: nsICryptoHash = hashComp.createInstance(
    Components.interfaces.nsICryptoHash,
  );
  ch.init(ch.SHA256!);
  ch.update(data, data.length);
  // finish(false) returns a binary string
  const binStr: string = ch.finish(false);
  let hex = "";
  for (let i = 0; i < binStr.length; i++) {
    hex += binStr.charCodeAt(i).toString(16).padStart(2, "0");
  }
  return hex;
}

interface LocalAttachmentInfo {
  id: number;
  key: string;
  filename: string;
  filePath: string | null;
  sha256: string | null;
}

/**
 * Build a list of existing local attachments with their SHA256 hashes
 * for robust deduplication.
 */
async function _getLocalAttachments(
  zoteroItem: Zotero.Item,
): Promise<LocalAttachmentInfo[]> {
  const result: LocalAttachmentInfo[] = [];
  for (const attId of zoteroItem.getAttachments()) {
    const att = Zotero.Items.get(attId);
    if (!att || !att.isAttachment()) continue;

    let filename = "";
    let fp: string | null;
    let hash: string | null = null;
    try {
      fp = (await att.getFilePathAsync()) || null;
      if (fp) {
        filename = PathUtils.filename(fp);
        const fileData = await IOUtils.read(fp);
        hash = sha256hex(fileData);
      }
    } catch {
      // File may not exist on disk
      fp = null;
    }
    if (!filename) {
      filename = att.attachmentFilename || "";
    }
    result.push({
      id: attId,
      key: att.key,
      filename,
      filePath: fp,
      sha256: hash,
    });
  }
  return result;
}

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

  // Clean up stale fileKeyMap entries: if a file was deleted on the
  // server, its map key still exists in fileKeyMap pointing to a local
  // attachment.  Remove these so pushFiles won't skip the local file.
  const remoteIdSet = new Set(remoteFiles.map((rf) => `m${rf.id}`));
  const itemAttKeys = new Set(
    zoteroItem
      .getAttachments()
      .map((id: number) => Zotero.Items.get(id)?.key)
      .filter(Boolean),
  );
  for (const mk of Object.keys(fileKeyMap)) {
    if (!mk.startsWith("m")) continue;
    // Only clean entries whose local attachment belongs to this item
    const localKey = fileKeyMap[mk] as string;
    if (itemAttKeys.has(localKey) && !remoteIdSet.has(mk)) {
      log(`Clearing stale file mapping ${mk} (server file removed)`);
      delete fileKeyMap[mk];
    }
  }

  // Build local attachment index for dedup
  const localAtts = await _getLocalAttachments(zoteroItem);
  const localByHash = new Map<string, LocalAttachmentInfo>();
  const localByName = new Map<string, LocalAttachmentInfo>();
  for (const la of localAtts) {
    if (la.sha256) localByHash.set(la.sha256, la);
    if (la.filename) localByName.set(la.filename, la);
  }

  for (const rf of remoteFiles) {
    const mapKey = `m${rf.id}`;
    if (fileKeyMap[mapKey]) continue; // Already mapped

    // 1. Dedup by SHA256 — strongest match
    const hashMatch = rf.sha256 ? localByHash.get(rf.sha256) : null;
    if (hashMatch) {
      fileKeyMap[mapKey] = hashMatch.key;
      log(
        `Re-linked file by SHA256: ${rf.filename}` +
          ` -> ${hashMatch.key} (${rf.sha256.slice(0, 8)}…)`,
      );
      continue;
    }

    // 2. Dedup by filename — fallback, but only when hashes are
    //    unknown or actually match.  If the server has a known hash
    //    that differs from the local file, the content was updated
    //    and we must re-download rather than re-link the old version.
    const nameMatch = localByName.get(rf.filename);
    if (nameMatch) {
      const hashesMatch =
        !rf.sha256 || !nameMatch.sha256 || rf.sha256 === nameMatch.sha256;
      if (hashesMatch) {
        fileKeyMap[mapKey] = nameMatch.key;
        log(`Re-linked file by name: ${rf.filename} -> ${nameMatch.key}`);
        continue;
      }
      log(
        `File ${rf.filename} exists locally but content differs` +
          ` (server=${rf.sha256?.slice(0, 8)}…,` +
          ` local=${nameMatch.sha256?.slice(0, 8)}…) — downloading`,
      );
    }

    // 3. No local match — download
    try {
      const data = await api.downloadFile(rf.id);

      // Verify downloaded content matches expected hash
      if (rf.sha256) {
        const dlHash = sha256hex(data);
        if (dlHash !== rf.sha256) {
          log(
            `Hash mismatch for ${rf.filename}:` +
              ` expected ${rf.sha256}, got ${dlHash}`,
          );
        }
      }

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

        // Add to local index so subsequent remote files in this batch
        // don't create duplicates
        const info: LocalAttachmentInfo = {
          id: attachment.id,
          key: attachment.key,
          filename: rf.filename,
          filePath: null,
          sha256: rf.sha256 || null,
        };
        if (info.sha256) localByHash.set(info.sha256, info);
        localByName.set(rf.filename, info);
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

  // Build reverse map: zotero_key -> miscite map key
  const reverseMap: Record<string, string> = {};
  for (const [k, v] of Object.entries(fileKeyMap)) {
    reverseMap[String(v)] = k;
  }

  let uploaded = 0;

  // Fetch existing remote files for dedup by hash and filename
  let remoteFiles: MisciteFile[] = [];
  try {
    const resp = await api.listItemFiles(misciteItemId);
    remoteFiles = resp.data;
  } catch {
    // If we can't list remote files, proceed without dedup
  }

  const remoteByHash = new Map<string, MisciteFile>();
  const remoteByName = new Map<string, MisciteFile>();
  for (const rf of remoteFiles) {
    if (rf.sha256) remoteByHash.set(rf.sha256, rf);
    remoteByName.set(rf.filename, rf);
  }

  // Re-establish mappings for any unlinked remote files
  const localAtts = await _getLocalAttachments(zoteroItem);
  for (const rf of remoteFiles) {
    const mk = `m${rf.id}`;
    if (fileKeyMap[mk]) continue;

    // Match by hash first, then filename
    const hashMatch = rf.sha256
      ? localAtts.find((la) => la.sha256 === rf.sha256)
      : null;
    const nameMatch = localAtts.find((la) => la.filename === rf.filename);
    const match = hashMatch || nameMatch;
    if (match) {
      fileKeyMap[mk] = match.key;
      reverseMap[match.key] = mk;
      log(
        `Re-linked remote file ${rf.filename} (m${rf.id})` +
          ` -> local ${match.key}`,
      );
    }
  }

  for (const la of localAtts) {
    if (reverseMap[la.key]) continue; // Already mapped
    if (!la.filePath) continue; // No file on disk

    try {
      // 1. Dedup by SHA256 — skip upload if content already on server
      if (la.sha256 && remoteByHash.has(la.sha256)) {
        const existing = remoteByHash.get(la.sha256)!;
        fileKeyMap[`m${existing.id}`] = la.key;
        log(
          `Skipping upload of ${la.filename}` +
            ` — identical content on server (SHA256 match)`,
        );
        continue;
      }

      // 2. Dedup by filename
      if (remoteByName.has(la.filename)) {
        const existing = remoteByName.get(la.filename)!;
        fileKeyMap[`m${existing.id}`] = la.key;
        log(`Skipping upload of ${la.filename} — already on server`);
        continue;
      }

      // 3. Upload
      const fileData = await IOUtils.read(la.filePath);
      const attItem = Zotero.Items.get(la.id);
      const contentType =
        attItem?.attachmentContentType || "application/octet-stream";

      log(
        `Uploading attachment ${la.key}` +
          ` (${la.filename})` +
          ` to miscite item ${misciteItemId}`,
      );
      const response = await api.uploadFile(
        misciteItemId,
        la.filename,
        contentType,
        fileData,
      );

      if (response.data) {
        fileKeyMap[`m${response.data.id}`] = la.key;
        uploaded++;
        log(
          `Uploaded file: ${la.filename}` +
            ` -> miscite file ${response.data.id}`,
        );

        // Add to remote index so subsequent attachments in this batch
        // don't create duplicates
        remoteByName.set(la.filename, response.data);
        if (response.data.sha256) {
          remoteByHash.set(response.data.sha256, response.data);
        }
      }
    } catch (err) {
      log(`Failed to push file ${la.key}: ${err}`);
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
