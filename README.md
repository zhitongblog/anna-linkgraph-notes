# LinkGraph Notes — Anna AI OS App

An independent, cross-device **Markdown Knowledge Vault & Interactive Graph App** built natively on the **Anna AI OS Host API** (`anna.storage` + `anna.llm.complete`).

## Features
- **Cross-Device Persistent Vault**: Automatically synced per user via Anna Persistent Storage (`anna.storage.get` / `anna.storage.set`) — runs on Web, Desktop, and Mobile with 0 ms cold start.
- **Interactive Knowledge Graph**: Real-time bidirectional `[[wiki-links]]`, clickable canvas node navigation, backlink pills, and 1-click unlinked mention linking.
- **Deterministic Vault Diagnostics**: Instant health score (0–100), broken `[[wiki-link]]` detector, orphan note finder, open `- [ ]` task extractor, and Markdown Brief export.
- **AI-Native Core (Zero API Keys)**:
  - **✨ AI Brief**: Context-aware synthesis of the active note and its linked neighbors.
  - **🔗 AI Link Ideas**: Discovers missing conceptual links and hub-note opportunities across the vault.
  - **🧠 Ask Vault**: Grounded Q&A across all notes with inline `[[Note Title]]` citations.

## Validate & Publish
```bash
anna-app validate --strict
anna-app login --host https://anna.partners
anna-app account set-handle <your-handle>
anna-app apps publish
anna-app apps submit-review
```

## License
Apache-2.0
