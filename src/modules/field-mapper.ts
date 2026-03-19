/**
 * Bidirectional field mapping between miscite items and Zotero items.
 */
import type { MisciteItem } from "./miscite-api";

// miscite work_type -> Zotero itemType
const WORK_TYPE_TO_ZOTERO: Record<string, string> = {
  article: "journalArticle",
  "journal-article": "journalArticle",
  book: "book",
  "book-chapter": "bookSection",
  "book-section": "bookSection",
  "conference-paper": "conferencePaper",
  dataset: "dataset",
  dissertation: "thesis",
  thesis: "thesis",
  preprint: "preprint",
  report: "report",
  review: "journalArticle",
  letter: "letter",
  editorial: "journalArticle",
  patent: "patent",
  webpage: "webpage",
  software: "computerProgram",
};

// Reverse mapping
const ZOTERO_TO_WORK_TYPE: Record<string, string> = {};
for (const [k, v] of Object.entries(WORK_TYPE_TO_ZOTERO)) {
  if (!ZOTERO_TO_WORK_TYPE[v]) {
    ZOTERO_TO_WORK_TYPE[v] = k;
  }
}

/**
 * Parse a name string into firstName/lastName.
 * Handles "Last, First" and "First Last" formats.
 */
function parseAuthorName(name: string): {
  firstName: string;
  lastName: string;
} {
  const trimmed = name.trim();
  if (trimmed.includes(",")) {
    const [last, ...rest] = trimmed.split(",");
    return {
      firstName: rest.join(",").trim(),
      lastName: last.trim(),
    };
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    return { firstName: "", lastName: parts[0] };
  }
  const lastName = parts.pop()!;
  return { firstName: parts.join(" "), lastName };
}

/**
 * Build extra field lines for citation metrics.
 */
function buildExtraLines(item: MisciteItem): string[] {
  const lines: string[] = [];
  const dateStr = new Date().toISOString().split("T")[0];

  if (item.cited_by_count != null) {
    lines.push(
      `${item.cited_by_count} citations (OpenAlex/DOI) [${dateStr}]`,
    );
  }
  if (item.fwci != null) {
    lines.push(`FWCI: ${item.fwci.toFixed(2)} (OpenAlex/DOI) [${dateStr}]`);
  }
  return lines;
}

/**
 * Parse citation count and FWCI from Zotero extra field.
 */
function parseExtraMetrics(extra: string): {
  citedByCount: number | null;
  fwci: number | null;
  otherLines: string[];
} {
  let citedByCount: number | null = null;
  let fwci: number | null = null;
  const otherLines: string[] = [];

  for (const line of extra.split("\n")) {
    const trimmed = line.trim();
    const citMatch = trimmed.match(/^(\d+)\s+citations\s+\(OpenAlex/i);
    if (citMatch) {
      citedByCount = parseInt(citMatch[1], 10);
      continue;
    }
    const fwciMatch = trimmed.match(/^FWCI:\s*([\d.]+)/i);
    if (fwciMatch) {
      fwci = parseFloat(fwciMatch[1]);
      continue;
    }
    if (trimmed) {
      otherLines.push(trimmed);
    }
  }
  return { citedByCount, fwci, otherLines };
}

/**
 * Convert a miscite item to Zotero item data for creation/update.
 */
export function misciteToZoteroData(
  item: MisciteItem,
): Record<string, unknown> {
  const itemType =
    WORK_TYPE_TO_ZOTERO[(item.work_type || "").toLowerCase()] ||
    "journalArticle";

  const creators = (item.authors || []).map((name: string) => {
    const parsed = parseAuthorName(
      typeof name === "string" ? name : String(name),
    );
    return {
      creatorType: "author",
      firstName: parsed.firstName,
      lastName: parsed.lastName,
    };
  });

  const extraLines = buildExtraLines(item);

  const data: Record<string, unknown> = {
    itemType,
    title: item.title || "",
    creators,
    DOI: item.doi || "",
    date: item.publication_year ? String(item.publication_year) : "",
    abstractNote: item.abstract || "",
  };

  // Map source_display_name based on item type
  if (
    itemType === "journalArticle" ||
    itemType === "preprint" ||
    itemType === "review"
  ) {
    data.publicationTitle = item.source_display_name || "";
  } else if (itemType === "bookSection" || itemType === "conferencePaper") {
    data.proceedingsTitle = item.source_display_name || "";
  } else if (itemType === "book") {
    data.publisher = item.source_display_name || "";
  }

  if (extraLines.length > 0) {
    data.extra = extraLines.join("\n");
  }

  return data;
}

/**
 * Convert a Zotero item to miscite API fields for creation/update.
 */
export function zoteroToMisciteData(
  zoteroItem: Zotero.Item,
): Partial<MisciteItem> {
  const itemType = zoteroItem.itemTypeID
    ? Zotero.ItemTypes.getName(zoteroItem.itemTypeID)
    : "journalArticle";
  const workType = ZOTERO_TO_WORK_TYPE[itemType] || itemType;

  // Extract authors
  const creators = zoteroItem.getCreators() as Array<{
    creatorType?: string;
    firstName?: string;
    lastName?: string;
    name?: string;
  }>;
  const authors = creators
    .filter((c) => c.creatorType === "author" || !c.creatorType)
    .map((c) => {
      if (c.firstName && c.lastName) {
        return `${c.firstName} ${c.lastName}`;
      }
      return c.lastName || c.name || "";
    })
    .filter(Boolean);

  const doi = zoteroItem.getField("DOI") as string;
  const title = zoteroItem.getField("title") as string;
  const date = zoteroItem.getField("date") as string;
  const publicationYear = date ? parseInt(date.slice(0, 4), 10) || null : null;
  const abstractNote = zoteroItem.getField("abstractNote") as string;
  const extra = (zoteroItem.getField("extra") as string) || "";

  // Source display name
  let sourceDisplayName = "";
  try {
    sourceDisplayName =
      (zoteroItem.getField("publicationTitle") as string) ||
      (zoteroItem.getField("proceedingsTitle") as string) ||
      (zoteroItem.getField("publisher") as string) ||
      "";
  } catch {
    // Field may not exist for this item type
  }

  // Parse metrics from extra field
  const metrics = parseExtraMetrics(extra);

  // Build full payload preserving all Zotero fields
  const payload: Record<string, unknown> = {
    zotero_item_type: itemType,
    abstract: abstractNote || undefined,
    cited_by_count: metrics.citedByCount,
    fwci: metrics.fwci,
    zotero_extra: metrics.otherLines.join("\n") || undefined,
  };

  // Add additional Zotero-specific fields to payload
  const zoteroFields = [
    "volume",
    "issue",
    "pages",
    "ISBN",
    "ISSN",
    "url",
    "language",
    "archive",
    "archiveLocation",
    "callNumber",
    "rights",
    "series",
    "seriesTitle",
    "place",
    "edition",
    "numPages",
  ];
  for (const field of zoteroFields) {
    try {
      const val = zoteroItem.getField(field) as string;
      if (val) {
        payload[`zotero_${field}`] = val;
      }
    } catch {
      // Field may not exist for this item type
    }
  }

  return {
    title: title || "Untitled",
    doi: doi || null,
    authors,
    source_display_name: sourceDisplayName || null,
    publication_year: publicationYear,
    work_type: workType,
    notes: null,
    abstract: abstractNote || null,
    payload,
  };
}
