/**
 * Find or create the "miscite.review" Zotero Group Library.
 */
import { getPref, setPref } from "./sync-state";
import { log } from "./utils";

const GROUP_NAME = "miscite.review";

/**
 * Get the library ID for the miscite.review group.
 */
export async function getGroupLibraryID(): Promise<number> {
  // Check cached value first
  const cached = getPref("groupLibraryId") as number;
  if (cached && cached > 0) {
    try {
      const lib = Zotero.Libraries.get(cached);
      if (lib) return cached;
    } catch {
      // Library no longer exists
    }
  }

  // Search existing group libraries
  const groups = Zotero.Groups.getAll();
  for (const group of groups) {
    if (group.name === GROUP_NAME) {
      const libraryID = group.libraryID;
      setPref("groupLibraryId", libraryID);
      log(`Found existing group library: ${GROUP_NAME} (ID: ${libraryID})`);
      return libraryID;
    }
  }

  // Create new group via Zotero API
  log(`Group library "${GROUP_NAME}" not found. Creating...`);
  const libraryID = await _createGroup();
  setPref("groupLibraryId", libraryID);
  return libraryID;
}

async function _createGroup(): Promise<number> {
  const userID = Zotero.Users.getCurrentUserID();
  if (!userID) {
    throw new Error(
      "Cannot create group library: not logged in to Zotero. " +
        "Please sign in to your Zotero account in Zotero preferences.",
    );
  }

  const apiKey = _getZoteroApiKey();
  if (!apiKey) {
    throw new Error(
      "Cannot create group library: no Zotero API key found. " +
        "Please sync your Zotero library at least once.",
    );
  }

  const response = await Zotero.HTTP.request(
    "POST",
    "https://api.zotero.org/groups",
    {
      headers: {
        "Zotero-API-Version": "3",
        "Zotero-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: GROUP_NAME,
        description: "Synced library from miscite.review",
        type: "Private",
        libraryEditing: "admins",
        libraryReading: "members",
      }),
      responseType: "json",
    },
  );

  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `Failed to create Zotero group "${GROUP_NAME}": ${response.status} ${String(response.responseText || "").slice(0, 200)}`,
    );
  }

  const data = response.response as { id?: number; data?: { id?: number } };
  const groupID = data.id || data.data?.id;
  if (!groupID) {
    throw new Error("Unexpected response when creating Zotero group");
  }

  // Sync to pull the new group into the local client
  await Zotero.Sync.Runner.sync({ libraries: "all" });

  const groups = Zotero.Groups.getAll();
  for (const group of groups) {
    if (group.name === GROUP_NAME) {
      log(`Created group library: ${GROUP_NAME} (ID: ${group.libraryID})`);
      return group.libraryID;
    }
  }

  throw new Error(
    `Created group "${GROUP_NAME}" but could not find it locally. Try syncing Zotero.`,
  );
}

function _getZoteroApiKey(): string | null {
  try {
    return (Zotero.Prefs.get("sync.server.apiKey") as string) || null;
  } catch {
    return null;
  }
}
