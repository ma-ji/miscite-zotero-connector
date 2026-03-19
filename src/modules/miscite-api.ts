/**
 * HTTP client for the miscite sync REST API.
 */
import { getPref } from "./sync-state";

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
}

export class MisciteApiClient {
  private baseUrl: string;
  private token: string;

  constructor() {
    this.baseUrl = ((getPref("serverUrl") as string) || "").replace(/\/+$/, "");
    this.token = (getPref("apiToken") as string) || "";
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}/api/v1/sync${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json",
    };
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    const response = await fetch(url, init);
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `miscite API error ${response.status}: ${text.slice(0, 200)}`,
      );
    }
    return (await response.json()) as T;
  }

  async testConnection(): Promise<{ user_id: string; email: string }> {
    return this.request("GET", "/me");
  }

  async listItems(
    since?: string,
  ): Promise<ApiEnvelope<MisciteItem[]>> {
    const qs = since ? `?since=${encodeURIComponent(since)}` : "";
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
    return this.request("POST", "/collections", { name, description });
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

  async listItemFiles(
    itemId: number,
  ): Promise<ApiEnvelope<MisciteFile[]>> {
    return this.request("GET", `/items/${itemId}/files`);
  }

  async downloadFile(fileId: number): Promise<ArrayBuffer> {
    const url = `${this.baseUrl}/api/v1/sync/files/${fileId}/download`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!response.ok) {
      throw new Error(`File download failed: ${response.status}`);
    }
    return response.arrayBuffer();
  }

  async deleteFile(fileId: number): Promise<{ ok: boolean }> {
    return this.request("DELETE", `/files/${fileId}`);
  }
}
