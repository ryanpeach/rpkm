# markdowndb — Design

**Date:** 2026-07-06
**Status:** Draft, pending approval

## Purpose

`markdowndb` loads a vault of CommonMark + YAML-frontmatter files into a
queryable in-memory index for the pkm MCP server. It exposes a typed Python
library API (in-process) supporting four read patterns:

1. Lookup by path
2. Filter by frontmatter fields
3. Full-text body search
4. Semantic (vector) search

plus a fused **hybrid search** over (3) and (4).

It is not a general service — no HTTP, no CLI in MVP. Consumers are the MCP
tool functions running in the same process.

## Scope constraints

- Target vault size: 10k–100k notes.
- Persistence model: notes index is **in-memory, rebuilt on startup**. Only
  expensive derived data (embeddings) is cached on disk.
- Updates: **both** filesystem watcher (external editor edits) and explicit
  `upsert` calls (MCP-originated writes).
- Surface: Python library API only.

## Architecture

Single query engine: **DuckDB in-memory**, with the `json`, `fts`, and `vss`
extensions. A second, **persistent** DuckDB database file
(`.markdowndb/cache.duckdb`) is `ATTACH`ed to hold the embedding cache so
expensive ONNX inference survives restarts.

```
+--------------------------------------------------------------+
|  MarkdownDB (in-process library)                              |
|                                                              |
|  in-memory DuckDB            persistent cache.duckdb (ATTACH) |
|  +----------------+          +-----------------------------+  |
|  | notes          |          | embedding_cache             |  |
|  | embeddings     | <--join--| (body_hash, model, vec)  |  |
|  | fts index      |          +-----------------------------+  |
|  | hnsw index     |                                           |
|  +----------------+                                           |
|        ^                                                      |
|        | parse (pydantic Frontmatter)                         |
|  +----------------+     +----------------+                    |
|  | vault walker   |     | watchdog       |                    |
|  +----------------+     +----------------+                    |
|        ^                        ^                             |
+--------|------------------------|----------------------------+
         | *.md files             | fs events
      vault dir --------------------
```

Embeddings are produced by **fastembed** (ONNX, no torch dependency), default
model `BAAI/bge-small-en-v1.5` (384-d). Configurable.

### Coding conventions

Per project `CLAUDE.md`: strong explicit typing throughout (must pass
`basedpyright`), all structured data modeled with **pydantic** `BaseModel`.
Lint/format via `ruff`; git hooks via `prek`.

## Data model

### Frontmatter (hybrid: typed expected fields + JSON catch-all)

```python
from pydantic import BaseModel, ConfigDict

class Frontmatter(BaseModel):
    model_config = ConfigDict(extra="allow")  # unknown keys -> model_extra
    id: str | None = None
    tags: list[str] = []
    aliases: list[str] = []
```

Expected fields (`id`, `tags`, `aliases`) are typed and validated. Every other
frontmatter key is preserved in `model_extra` and serialized to the DuckDB
`extra JSON` column. Parsing is `Frontmatter.model_validate(yaml_dict)`.

### Note / SearchHit

```python
class Note(BaseModel):
    path: str            # relative to vault root
    frontmatter: Frontmatter
    body: str
    mtime: float
    file_hash: str    # sha256(raw file)
    body_hash: str    # sha256(body)

class SearchHit(BaseModel):
    note: Note
    score: float
    snippet: str | None = None   # FTS/hybrid only; None for pure semantic
```

### DuckDB schema

In-memory (rebuilt each startup):

```sql
CREATE TABLE notes (
  path         VARCHAR PRIMARY KEY,   -- relative path from vault root
  file_hash    VARCHAR NOT NULL,      -- sha256(raw file); change detection
  body_hash    VARCHAR NOT NULL,      -- sha256(body); embedding cache key
  mtime        DOUBLE  NOT NULL,      -- fs mtime, watcher diffing
  id           VARCHAR,               -- expected frontmatter
  tags         VARCHAR[],
  aliases      VARCHAR[],
  extra        JSON,                  -- all non-expected frontmatter keys
  body         VARCHAR NOT NULL
);

CREATE TABLE embeddings (
  path      VARCHAR PRIMARY KEY,
  embedding FLOAT[384]
);
-- fts index:  PRAGMA create_fts_index('notes','path','body')
-- vss index:  HNSW on embeddings.embedding
```

Persistent (`.markdowndb/cache.duckdb`):

```sql
CREATE TABLE embedding_cache (
  body_hash VARCHAR PRIMARY KEY,  -- sha256(body); dedups identical bodies
  model        VARCHAR NOT NULL,     -- embed model id; invalidate on swap
  embedding    FLOAT[384]
);
```

Cache is keyed by `body_hash`, not path — moving/renaming a note reuses its
embedding; duplicate bodies share one row.

## Python API

```python
db = MarkdownDB(
    vault="~/notes",
    embed_model="BAAI/bge-small-en-v1.5",
    watch=True,
)
db.load()                       # initial scan; idempotent

# lookup
note: Note | None = db.get("journal/2026-07-06.md")

# structured filter (Django-lookup style suffixes)
todos  = db.filter(tags__contains="todo")
recent = db.filter(id__isnull=False, tags__in=["project", "pkm"])
proj   = db.filter(extra__project="pkm")   # dot into JSON catch-all

# escape hatch for anything the filter DSL can't express
rows = db.sql("SELECT path FROM notes WHERE json_contains(extra, ?)",
              ['{"weight_kg": 80}'])

# search
hits: list[SearchHit] = db.search_text("collectors fallacy", limit=10)
hits = db.search_semantic("note-taking philosophy", k=10)
hits = db.search("note-taking philosophy", limit=10)   # hybrid (RRF)

# writes / reindex
db.upsert("journal/2026-07-06.md")   # re-parse from disk
db.delete("old.md")
db.close()
```

### Filter lookup suffixes (closed set)

| Suffix          | SQL                          |
|-----------------|------------------------------|
| (none)          | `col = ?`                    |
| `__in`          | `col IN (...)`               |
| `__contains`    | array contains (tags/aliases)|
| `__gte` `__lte` | range                        |
| `__gt` `__lt`   | range                        |
| `__isnull`      | `col IS [NOT] NULL`          |
| `extra__<key>`  | `extra->>'<key>' = ?`        |

Anything beyond this set → `db.sql(...)`.

### Hybrid search fusion

`db.search(...)` fuses FTS bm25 ranking with semantic kNN ranking via
**Reciprocal Rank Fusion (RRF)**: `score = sum(1 / (k + rank))`, `k = 60`.
No score normalization needed; robust and standard.

## Data flow

### Startup: `load()`

1. Open in-memory DuckDB; `INSTALL`/`LOAD` json, fts, vss.
2. `ATTACH '.markdowndb/cache.duckdb' AS cache` (create if absent).
3. Walk vault; for each `*.md`: read text, split frontmatter/body, parse YAML,
   `Frontmatter.model_validate(...)`, compute `body_hash`, `INSERT` note row.
4. Embeddings: `LEFT JOIN notes ↔ cache.embedding_cache` on
   `body_hash AND model`; embed misses via fastembed; `INSERT` new rows into
   cache; copy needed vectors into in-memory `embeddings` table.
5. Build FTS index and HNSW index.
6. If `watch=True`, start watchdog observer on the vault dir.

### Live upsert: `upsert(path)` (MCP write OR watchdog event)

- Re-read file, recompute `file_hash`.
- `file_hash` unchanged → update `mtime` only, done.
- `file_hash` changed → reparse; replace `notes` row (frontmatter/body/columns).
  Recompute `body_hash`; if `body_hash` also changed and not in cache, re-embed;
  if `body_hash` unchanged, reuse the cached embedding (frontmatter-only edit).
  Refresh FTS + HNSW entry for that row.

### Delete: `delete(path)`

- Drop `notes` row and its FTS/HNSW entry. Cache row is left in place (harmless,
  reused if the content reappears).

### Watcher / explicit dedupe

Debounce by `(path, mtime, file_hash)`. An MCP write triggers an explicit `upsert`;
watchdog then fires for the same write; the second `upsert` sees an unchanged
file_hash and no-ops. Prevents double embedding work.

## Error handling

- Malformed YAML → log warning, index note with empty `Frontmatter`; body still
  searchable. Never crash the walk.
- Frontmatter not a mapping (e.g. top-level list) → same: warn, empty
  frontmatter.
- Non-UTF8 / unreadable file → skip, warn, continue.
- Embed model download/init failure → FTS + filter still work; semantic and
  hybrid degrade to FTS-only with a logged warning.
- Cache model mismatch (embed model changed) → rows with the old `model` are
  ignored; content re-embedded under the new model id.
- `db.sql()` → raw DuckDB errors propagate to the caller.

## Observability (OpenTelemetry)

`markdowndb` depends only on **`opentelemetry-api`** and emits against the
global provider (no-op if unconfigured). The MCP server app installs the SDK +
exporter. This keeps the library backend-agnostic and zero-overhead in tests.

### Spans

- `markdowndb.load` — attrs `note_count`, `cache_hits`, `cache_misses`, `duration`
- `markdowndb.upsert` — attrs `path`, `file_changed`, `embedded`
- `markdowndb.search` — attrs `mode` (text|semantic|hybrid), `query_len`, `result_count`
- `markdowndb.embed` — attrs `batch_size`, `model` (the expensive span)
- `markdowndb.parse` — records malformed-YAML exceptions as span events

### Metrics

- `markdowndb.notes.indexed` (gauge)
- `markdowndb.embed.cache_hit_ratio` (hit/miss counters)
- `markdowndb.search.latency` (histogram, by mode)
- `markdowndb.upsert.count` (counter)

### Logs

Bridge existing `logging` warnings (malformed YAML, degraded semantic) to OTEL
logs via `LoggingHandler`, configured app-side.

### App wiring (MCP server, not the library)

SDK configured from standard env vars: `OTEL_EXPORTER_OTLP_ENDPOINT`,
`OTEL_SERVICE_NAME=pkm-mcp`, `OTEL_TRACES_EXPORTER`. Default behavior:
**env-driven OTLP with a console-exporter fallback** — if
`OTEL_EXPORTER_OTLP_ENDPOINT` is set, export OTLP; otherwise use the console
exporter for local dev. No hardcoded backend.

## Testing (TDD, pytest)

- **Unit:** frontmatter split + `Frontmatter.model_validate` (typed fields,
  extra passthrough, malformed → empty); `body_hash` stability; cache
  hit/miss logic.
- **Integration** (tmp vault fixture): `load` → `get`, `filter` (each lookup
  suffix), `search_text`, `search_semantic`, `search` (RRF).
- **Integration:** `upsert` changes body → new results; `delete` removes; rename
  reuses cached embedding.
- **Integration:** watchdog fires `upsert` on external file write.
- **Cache persistence:** two `MarkdownDB` instances across a restart skip
  re-embed (assert embed called 0 times).
- Embeddings mocked in most tests (deterministic fake vectors); one real-model
  smoke test marked `slow`.

## Dependencies

- `markdowndb`: duckdb, pyyaml, fastembed, watchdog, pydantic, opentelemetry-api
- `pkm` (MCP server): + fastmcp, opentelemetry-sdk, opentelemetry-exporter-otlp

## Out of scope (YAGNI)

- HTTP/REST service, CLI.
- Promoting `status`/`created`/`updated`/`title` to typed columns (kept in
  `extra`; promote later only if a query proves slow).
- Hybrid score weighting/tuning knobs beyond RRF's fixed `k`.
- Multi-vault support.
