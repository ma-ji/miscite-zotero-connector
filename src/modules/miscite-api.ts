/**
 * HTTP client for the miscite sync REST API.
 * Uses Zotero.HTTP.request instead of fetch (not available in sandbox).
 */
import { getPref } from "../utils/prefs";

export interface MisciteItem {
  id: number;
  openalex_id: string | null;
  doi: string | null;
  title: string;
  authors: string[];
  source_display_name: string | null;
  publication_year: number | null;
  work_type: string | null;
  notes: string | null;
  abstract: string | null;
  cited_by_count: number | null;
  fwci: number | null;
  payload: Record<string, unknown>;
  collection_ids: number[];
  created_at: string;
  updated_at: string;
}

export interface MisciteCollection {
  id: number;
  name: string;
  description: string | null;
  is_default: boolean;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export interface MisciteFile {
  id: number;
  item_id: number;
  filename: string;
  content_type: string;
  file_size: number;
  sha256: string;
  source: string;
  created_at: string;
}

export interface ApiEnvelope<T> {
  data: T;
  server_time: string;
  has_more: boolean;
  deleted_ids?: number[];
}

export class MisciteApiClient {
  private readonly baseUrl = "https://miscite.review";
  private token: string;

  constructor() {
    this.token = (getPref("apiToken") as string) || "";
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: { responseType?: string },
  ): Promise<T> {
    const url = `${this.baseUrl}/api/v1/sync${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json",
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    // Zotero.HTTP.request throws on non-2xx status codes
    const response = await Zotero.HTTP.request(method, url, {
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      responseType: (options?.responseType ??
        "json") as XMLHttpRequestResponseType,
    });
    return response.response as T;
  }

  async testConnection(): Promise<{
    user_id: string;
    email: string;
  }> {
    return this.request("GET", "/me");
  }

  async listItems(
    since?: string,
    offset?: number,
  ): Promise<ApiEnvelope<MisciteItem[]>> {
    const params: string[] = [];
    if (since) params.push(`since=${encodeURIComponent(since)}`);
    if (offset && offset > 0) params.push(`offset=${offset}`);
    const qs = params.length > 0 ? `?${params.join("&")}` : "";
    return this.request("GET", `/items${qs}`);
  }

  async getItem(id: number): Promise<ApiEnvelope<MisciteItem>> {
    return this.request("GET", `/items/${id}`);
  }

  async createItem(
    item: Partial<MisciteItem>,
  ): Promise<ApiEnvelope<MisciteItem>> {
    return this.request("POST", "/items", item);
  }

  async updateItem(
    id: number,
    fields: Partial<MisciteItem>,
  ): Promise<ApiEnvelope<MisciteItem>> {
    return this.request("PUT", `/items/${id}`, fields);
  }

  async deleteItem(id: number): Promise<{ ok: boolean }> {
    return this.request("DELETE", `/items/${id}`);
  }

  async listCollections(
    since?: string,
  ): Promise<ApiEnvelope<MisciteCollection[]>> {
    const qs = since ? `?since=${encodeURIComponent(since)}` : "";
    return this.request("GET", `/collections${qs}`);
  }

  async createCollection(
    name: string,
    description?: string,
  ): Promise<ApiEnvelope<MisciteCollection>> {
    return this.request("POST", "/collections", {
      name,
      description,
    });
  }

  async updateCollection(
    id: number,
    fields: Partial<MisciteCollection>,
  ): Promise<ApiEnvelope<MisciteCollection>> {
    return this.request("PUT", `/collections/${id}`, fields);
  }

  async deleteCollection(id: number): Promise<{ ok: boolean }> {
    return this.request("DELETE", `/collections/${id}`);
  }

  async setItemCollections(
    itemId: number,
    collectionIds: number[],
  ): Promise<{ ok: boolean }> {
    return this.request("POST", `/items/${itemId}/collections`, {
      collection_ids: collectionIds,
    });
  }

  async listItemFiles(itemId: number): Promise<ApiEnvelope<MisciteFile[]>> {
    return this.request("GET", `/items/${itemId}/files`);
  }

  async downloadFile(fileId: number): Promise<Uint8Array> {
    const url = `${this.baseUrl}/api/v1/sync` + `/files/${fileId}/download`;
    const response = await Zotero.HTTP.request("GET", url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
      },
      responseType: "arraybuffer",
    });
    return new Uint8Array(response.response as ArrayBuffer);
  }

  async uploadFile(
    itemId: number,
    filename: string,
    contentType: string,
    data: Uint8Array,
  ): Promise<ApiEnvelope<MisciteFile>> {
    const url = `${this.baseUrl}/api/v1/sync` + `/items/${itemId}/files`;

    // Build multipart form data manually since FormData
    // is not available in the Zotero sandbox environment
    const boundary = `----MisciteBoundary${Date.now()}`;
    const header =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; ` +
      `name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`;
    const footer = `\r\n--${boundary}--\r\n`;

    const headerBytes = new TextEncoder().encode(header);
    const footerBytes = new TextEncoder().encode(footer);
    const body = new Uint8Array(
      headerBytes.length + data.length + footerBytes.length,
    );
    body.set(headerBytes, 0);
    body.set(data, headerBytes.length);
    body.set(footerBytes, headerBytes.length + data.length);

    // Pass the raw ArrayBuffer to Zotero.HTTP.request so binary
    // content is not corrupted by string encoding
    const response = await Zotero.HTTP.request("POST", url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body: body.buffer as unknown as string,
      responseType: "json",
    });
    return response.response as ApiEnvelope<MisciteFile>;
  }

  async deleteFile(fileId: number): Promise<{ ok: boolean }> {
    return this.request("DELETE", `/files/${fileId}`);
  }
}
