# Miscite Connector for Zotero

A Zotero plugin (7, 8 & 9) that provides bidirectional synchronization between [miscite.review](https://miscite.review) and your Zotero library.

## Features

- **Two-way sync** — pull items from miscite into Zotero and push local changes back
- **File attachments** — download files from miscite; upload Zotero attachments back
- **DOI deduplication** — existing Zotero items with matching DOIs are linked, not duplicated
- **Collection sync** — miscite folders become nested subcollections under a "miscite.review" root collection
- **Incremental sync** — only transfers changes since the last sync
- **Auto-sync** — configurable interval (5, 15, 30, or 60 minutes)
- **Delete propagation** — items, user collections, and files deleted in Zotero are deleted on the server
- **Citation metrics** — citation count and FWCI stored in Zotero's Extra field
- **Localization** — English and Chinese (zh-CN)

## Installation

**Requirements:** Zotero 7, 8, or 9 and a [miscite.review](https://miscite.review) account.

1. Download the latest `.xpi` file from [Releases](https://github.com/ma-ji/miscite-zotero-connector/releases)
2. In Zotero, go to **Tools → Add-ons**
3. Click the gear icon → **Install Add-on From File…**
4. Select the downloaded `.xpi` file

## Setup

1. Go to **Zotero → Settings → Miscite Connector**
2. Enter your API token (generate one from your miscite account settings)
3. Click **Test Connection** to verify
4. Optionally enable auto-sync and set the interval

The connector syncs with `https://miscite.review`; the server URL is fixed in the extension and is not a user preference.

## Usage

### Syncing

From **Zotero → Settings → Miscite Connector**:

- **Sync Now** — runs an incremental sync (only changes since last sync)
- **Full Re-sync** — clears all sync state and pulls everything fresh

All synced items live in a **"miscite.review"** collection in your personal Zotero library. The plugin never touches items or collections outside this scope.

### How sync works

1. **Pull collections** — miscite folder paths become nested subcollections under "miscite.review"
2. **Pull items** — new items from miscite are created in Zotero; existing items across the whole Zotero library are linked by DOI without duplication
3. **Push local changes** — newer Zotero items, nested collection paths, and attachments are pushed back to miscite
4. **Process deletes** — local item, file, and user-created collection deletes are propagated to the server; system collections are preserved

When the same item changes on both sides, the newer `updated_at` / Zotero modified timestamp wins. The merge is **non-destructive**: an empty field on one side never blanks a populated field on the other, so a record missing (for example) author info will not wipe authors that already exist on the other side. Server-sourced citation metrics are still refreshed in the Extra field. The protected system collections are `Unfiled`, `Readlist`, and `Own publications`.

### Item type mapping

| miscite type               | Zotero type      |
| -------------------------- | ---------------- |
| article, journal-article   | Journal Article  |
| review, editorial          | Journal Article  |
| book                       | Book             |
| book-chapter, book-section | Book Section     |
| conference-paper           | Conference Paper |
| dataset                    | Dataset          |
| dissertation, thesis       | Thesis           |
| preprint                   | Preprint         |
| report                     | Report           |
| letter                     | Letter           |
| patent                     | Patent           |
| webpage                    | Web Page         |
| software                   | Computer Program |

### Citation metrics

Citation count and FWCI (Field-Weighted Citation Impact) from miscite are stored in Zotero's **Extra** field. User-added content in the Extra field is preserved during updates.

---

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) >= 22.22.3 (use `nvm use` against `.nvmrc`, or rely on the local build-time `node` devDependency which puts Node 22 on `node_modules/.bin` for `npm run` scripts even when the system `node` is older)
- [Zotero 7, 8, or 9](https://www.zotero.org/)

### Getting started

```bash
git clone https://github.com/ma-ji/miscite-zotero-connector.git
cd miscite-zotero-connector
npm install
cp .env.example .env
# Edit .env with your Zotero binary and profile paths
```

### Commands

```bash
npm start            # Launch Zotero with hot-reload
npm run build        # Build .xpi to .scaffold/build/
npm run lint:check   # Check formatting and lint rules
npm run lint:fix     # Auto-fix
```

### Project structure

```text
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
    └── prefs.ts          # Type-safe preference access

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

### Releasing

Releases are automated via GitHub Actions. When a version tag is pushed, the [release workflow](.github/workflows/release.yml) builds the XPI and creates a GitHub Release with the XPI and update manifests attached.

To publish a new release:

```bash
npx bumpp
```

This will interactively prompt you to pick a version bump (patch/minor/major), update `package.json`, create a git tag, and push — which triggers the release workflow automatically.

Alternatively, tag and push manually:

```bash
git tag v0.2.0
git push origin v0.2.0
```

## License

AGPL-3.0-or-later
