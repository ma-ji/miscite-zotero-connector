# Miscite Connector for Zotero

A Zotero 7 plugin that provides bidirectional synchronization between [miscite.review](https://miscite.review) and your Zotero library.

## Features

- **Pull items** from your miscite library into Zotero with full metadata (title, authors, DOI, publication year, source, abstract, citation metrics)
- **Push items** from Zotero back to miscite for items in the "miscite.review" collection
- **DOI-based deduplication** — existing Zotero items with matching DOIs are linked rather than duplicated
- **Collection sync** — miscite folders are synced as subcollections under a "miscite.review" root collection in your personal library
- **File attachment sync** — download files from miscite; upload Zotero attachments back
- **Incremental sync** — only transfers changes since the last sync
- **Auto-sync** — configurable interval (5, 15, 30, or 60 minutes)
- **Delete propagation** — items deleted in Zotero are deleted on the server
- **Chinese (zh-CN) localization**

## Requirements

- Zotero 7 (version 6.999+)
- A miscite.review account with an API token

## Installation

1. Download the latest `.xpi` file from [Releases](https://github.com/ma-ji/miscite-zotero-connector/releases)
2. In Zotero, go to **Tools → Add-ons**
3. Click the gear icon → **Install Add-on From File…**
4. Select the downloaded `.xpi` file

## Setup

1. Go to **Zotero → Settings → Miscite Connector**
2. Enter your miscite server URL (default: `https://miscite.review`)
3. Enter your API token (generate one from your miscite account settings)
4. Click **Test Connection** to verify
5. Optionally enable auto-sync and set the interval

## Usage

### Syncing

From **Zotero → Settings → Miscite Connector**:

- **Sync Now** — runs an incremental sync (only changes since last sync)
- **Full Re-sync** — clears all sync state and pulls everything fresh

### How sync works

All synced items live in a **"miscite.review"** collection in your personal Zotero library. The plugin never touches items or collections outside this scope.

1. **Pull collections** — miscite folders become subcollections under "miscite.review"
2. **Pull items** — new items from miscite are created in Zotero; existing items (matched by DOI) are linked without duplication
3. **Push items** — items in the "miscite.review" collection that were modified locally are pushed back to miscite
4. **Process deletes** — items deleted from the "miscite.review" collection in Zotero are deleted on the server

### Item type mapping

| miscite type               | Zotero type      |
| -------------------------- | ---------------- |
| article, journal-article   | Journal Article  |
| book                       | Book             |
| book-chapter, book-section | Book Section     |
| conference-paper           | Conference Paper |
| dataset                    | Dataset          |
| dissertation, thesis       | Thesis           |
| preprint                   | Preprint         |
| report                     | Report           |
| patent                     | Patent           |
| webpage                    | Web Page         |
| software                   | Computer Program |

### Citation metrics

Citation count and FWCI (Field-Weighted Citation Impact) from miscite are stored in Zotero's **Extra** field. User-added content in the Extra field is preserved during updates.

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [Zotero 7](https://www.zotero.org/)

### Setup

```bash
git clone https://github.com/ma-ji/miscite-zotero-connector.git
cd miscite-zotero-connector
npm install
cp .env.example .env
# Edit .env with your Zotero binary and profile paths
```

### Development server

```bash
npm start
```

This launches Zotero with the plugin loaded and hot-reloads on file changes.

### Build

```bash
npm run build
```

Produces an `.xpi` file in `.scaffold/build/`.

### Lint

```bash
npm run lint:check   # check formatting and lint rules
npm run lint:fix     # auto-fix
```

### Project structure

```
src/
├── index.ts              # Entry point, global setup
├── addon.ts              # Addon class with lifecycle state
├── hooks.ts              # Lifecycle hooks, sync triggers, delete notifier
├── modules/
│   ├── sync-engine.ts    # Core 4-phase sync orchestration
│   ├── miscite-api.ts    # REST API client for miscite
│   ├── library.ts        # Personal library & root collection management
│   ├── field-mapper.ts   # Bidirectional field/type mapping
│   ├── file-sync.ts      # File attachment pull/push
│   ├── preferences.ts    # Preferences pane event wiring
│   ├── sync-state.ts     # Preference-backed keymap & delete queue
│   └── utils.ts          # Logging utilities
└── utils/
    ├── ztoolkit.ts       # ZoteroToolkit initialization
    ├── locale.ts         # Fluent localization helpers
    ├── prefs.ts          # Type-safe preference access
    └── window.ts         # Window lifecycle helpers

addon/
├── bootstrap.js          # Zotero plugin lifecycle entry point
├── manifest.json         # Plugin manifest with placeholders
├── prefs.js              # Default preference values
├── content/
│   ├── preferences.xhtml # Settings UI
│   └── icons/            # Plugin icons (48px, 96px)
└── locale/
    ├── en-US/            # English strings
    └── zh-CN/            # Chinese strings
```

## License

AGPL-3.0-or-later
