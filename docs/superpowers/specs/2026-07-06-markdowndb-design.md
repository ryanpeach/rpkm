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

It is not a general service — no HTTP. Consumers are the MCP tool functions
running in the same process. A `markdowndb lint` CLI is provided as a prek
pre-commit hook for vault validation.

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

# MCP-facing mutators: write/remove file, reindex, AND auto-commit
db.write("journal/2026-07-06.md", text)   # -> git commit (AI message)
db.remove("old.md")                       # -> git commit

# reindex only (no git) — used by the watchdog / external edits
db.upsert("journal/2026-07-06.md")   # re-parse from disk
db.delete("old.md")

# validation (bulk pre-flight; collects every violation)
report: ValidationReport = db.validate()      # or db.validate(paths=[...])
if not report.ok:
    for v in report.violations:
        print(f"{v.path}:{v.line} [{v.check}] {v.message}")

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

## Validation

This is a code-first tool: every file **must** parse. There is no graceful
"index it anyway" mode for parse failures. Validation is strict — any violation
is an **error** (no configurable severity, no warn level).

Two enforcement points:

- **Runtime (`load`/`upsert`)** — parse checks (yaml, commonmark) are enforced
  per file and raise `MarkdownParseError` (with `path` + `line`) on failure.
  Fail fast; a malformed file is a bug to fix, not something to index partially.
- **Pre-commit (`db.validate` + `markdowndb lint` CLI)** — validates a set of
  files, collecting **every** violation across all three checks in one pass
  instead of raising on the first. The library returns a `ValidationReport`; the
  CLI wraps it for prek.

### Checks

1. **yaml** — the frontmatter block parses as YAML *and* is a mapping.
2. **commonmark** — the body parses under a CommonMark-compliant parser
   (`markdown-it-py`, `commonmark` preset) with no error.
3. **links** — every Markdown inline/reference link `[text](target)` whose
   `target` is a relative path (not `http(s):`/`mailto:`) resolves to an existing
   file. Resolution is relative to the linking note's own directory, per
   CommonMark — there is no vault-root-relative form. Wikilinks, heading anchors,
   and external-URL liveness are out of scope.

### Report model

```python
class Violation(BaseModel):
    path: str
    check: Literal["yaml", "commonmark", "links"]
    message: str
    line: int | None = None

class ValidationReport(BaseModel):
    violations: list[Violation]

    @property
    def ok(self) -> bool:
        return not self.violations
```

All violations are errors; `report.ok` is `True` only when the list is empty.

### CLI (prek hook)

`markdowndb lint [PATHS...]` validates the given files (prek passes staged
paths), prints one line per violation, and exits non-zero if any are found.
Registered as a console script; wired in the vault repo's `.pre-commit-config.yaml`:

```yaml
- repo: local
  hooks:
    - id: markdowndb-lint
      name: markdowndb lint
      entry: markdowndb lint
      language: system
      types: [markdown]
```

## Data flow

### Startup: `load()`

1. Open in-memory DuckDB; `INSTALL`/`LOAD` json, fts, vss.
2. `ATTACH '.markdowndb/cache.duckdb' AS cache` (create if absent).
3. Walk vault; for each `*.md`: read text, split frontmatter/body, parse YAML,
   `Frontmatter.model_validate(...)`, compute `body_hash`, `INSERT` note row.
   Parse failures (yaml/commonmark) raise `MarkdownParseError` — the file must
   be fixed (see Validation).
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

## Configuration

The **config framework** lives in the app layer (`pkm`) — `markdowndb` takes
explicit constructor args and has no `pydantic-settings` dependency. `pkm/config.py`
reads settings and constructs the library from them. (Git and litellm, by
contrast, live *inside* `markdowndb` — see Git integration.)

### Discovery

The vault is a git repository (per the PKM git-versioning requirement). The
**vault root is the directory containing `.git`**, located at runtime by
`markdowndb.find_vault_root(start)` (GitPython, walking up parents). `pkm/config.py`
reuses it to locate `<vault_root>/pkm.yaml`. If no git repo is found, it raises a
clear error (the tool assumes a versioned vault).

### Settings model (`pkm/config.py`)

A `pydantic-settings` `BaseSettings` model. Sources and precedence:

**env (`PKM_` prefix) > `pkm.yaml` > field defaults.**

```python
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict, YamlConfigSettingsSource

class PkmSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="PKM_", extra="forbid")

    embed_model: str = "BAAI/bge-small-en-v1.5"
    watch: bool = True
    cache_dir: Path = Path(".markdowndb")   # relative to vault root
    search_limit: int = 10
    commit_model: str = "openrouter/free"   # litellm model id; needs OPENROUTER_API_KEY

    @classmethod
    def settings_customise_sources(cls, settings_cls, init_settings,
                                   env_settings, dotenv_settings, file_secret_settings):
        # env wins over yaml; yaml over defaults
        yaml = YamlConfigSettingsSource(settings_cls)   # yaml_file set at load time
        return (init_settings, env_settings, yaml)
```

`config.py` computes the vault root, points the YAML source at
`<vault_root>/pkm.yaml`, builds `PkmSettings`, and wires a `MarkdownDB`:
`vault` is the git root itself; `cache_dir` resolves under it. `vault` is not a
settable field — it is always the git root, never overridden.

### Example `pkm.yaml`

```yaml
embed_model: BAAI/bge-small-en-v1.5
watch: true
cache_dir: .markdowndb
search_limit: 10
commit_model: openrouter/free
```

Any field can be overridden by env, e.g. `PKM_WATCH=false`,
`PKM_EMBED_MODEL=BAAI/bge-base-en-v1.5`.

## Git integration & auto-commit

Git lives **inside the `markdowndb` library**, centralized in
`markdowndb/vault_git.py` around a single `git.Repo` (GitPython). Two uses:

- **Vault-root discovery** — `find_vault_root(start)` walks up to the directory
  containing `.git`. Exposed so the `pkm` app reuses it to locate `pkm.yaml`.
- **Auto-commit** after MCP-originated writes.

### Reindex vs commit

The distinction is which method you call, not a flag:

- `db.upsert(path)` / `db.delete(path)` — **reindex only, no git**. Used by the
  watchdog and internally.
- `db.write(path, text)` / `db.remove(path)` — the **MCP-facing mutators**: write
  (or remove) the file on disk, reindex, then commit the changed path. These are
  the only methods that touch git.

### Policy

- Only MCP-originated mutations (`write`/`remove`) commit. Watchdog-detected
  external edits go through `upsert`/`delete` and are **not** committed — the user
  versions those.
- Auto-commit is core behavior, not configurable (always on).
- One commit per mutation, scoped to the changed file only
  (`repo.index.add([path])`, remove for deletes). Never `git add -A`.

### Message generation (litellm)

- Stage the changed path, take the **staged diff**, ask litellm (`commit_model`)
  for a one-line summary.
- litellm failure/timeout → deterministic fallback (`update <path>`,
  `add <path>`, `delete <path>`). The commit **always** happens; a message-gen
  failure never blocks or drops the mutation.
- API keys come from the environment (litellm provider vars, e.g.
  `OPENROUTER_API_KEY`) — never in `pkm.yaml`.

### Co-signing

Author and committer are the user's normal git identity. The AI is credited with
a trailer:

```
<subject line>

Co-Authored-By: <commit_model> <noreply@pkm.local>
```

### Write path (MCP write/delete tool)

`db.write(path, text)` (or `db.remove(path)`):

1. Write (or remove) the file on disk.
2. Reindex (the `upsert`/`delete` internals).
3. Stage the path → staged diff → litellm message (or fallback) → append the
   `Co-Authored-By` trailer → `repo.index.commit(...)`.

## Error handling

- Malformed YAML → raise `MarkdownParseError` (path + line). Code-first: the
  file is fixed, not indexed partially. See Validation.
- Frontmatter not a mapping (e.g. top-level list) → same: raise.
- Body fails CommonMark parse → raise `MarkdownParseError`.
- Non-UTF8 / unreadable file → raise (cannot parse).
- Embed model download/init failure → FTS + filter still work; semantic and
  hybrid degrade to FTS-only with a logged warning. (Operational degradation is
  fine; parse failures are not.)
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
- `markdowndb.parse` — per-file yaml+commonmark parse (leaf span; fires under
  both `load`/`upsert` and `validate`); records `MarkdownParseError` as a span
  event before raising
- `markdowndb.validate` — bulk validation pass (parent of the per-file `parse`
  spans + link checks); attrs `file_count`, `violation_count`
- `markdowndb.commit` — auto-commit on `write`/`remove`; attrs `path`,
  `fallback_used` (whether litellm failed and the deterministic message was used)

### Metrics

- `markdowndb.notes.indexed` (gauge)
- `markdowndb.embed.cache_hit_ratio` (hit/miss counters)
- `markdowndb.search.latency` (histogram, by mode)
- `markdowndb.upsert.count` (counter)

### Logs

Bridge existing `logging` warnings (degraded semantic, cache model mismatch) to
OTEL logs via `LoggingHandler`, configured app-side. Parse failures are raised as
`MarkdownParseError`, not logged-and-swallowed.

### App wiring (MCP server, not the library)

SDK configured from standard env vars: `OTEL_EXPORTER_OTLP_ENDPOINT`,
`OTEL_SERVICE_NAME=pkm-mcp`, `OTEL_TRACES_EXPORTER`. Default behavior:
**env-driven OTLP with a console-exporter fallback** — if
`OTEL_EXPORTER_OTLP_ENDPOINT` is set, export OTLP; otherwise use the console
exporter for local dev. No hardcoded backend.

## Testing (TDD, pytest)

- **Unit:** frontmatter split + `Frontmatter.model_validate` (typed fields,
  extra passthrough); `body_hash` stability; cache hit/miss logic.
- **Unit (validation):** malformed YAML / non-mapping frontmatter / bad
  CommonMark → `MarkdownParseError` raised at `load`/`upsert`; `db.validate`
  collects all violations without raising; link check resolves valid relative
  links and flags broken / missing targets; external URLs and `mailto:` ignored.
- **CLI:** `markdowndb lint` exits 0 on a clean file set, non-zero with printed
  violations on a dirty one.
- **Config:** `PkmSettings` loads defaults; `pkm.yaml` at the git root overrides
  defaults; `PKM_*` env overrides `pkm.yaml`; vault root resolved via GitPython;
  missing git repo raises a clear error.
- **Integration** (tmp vault fixture): `load` → `get`, `filter` (each lookup
  suffix), `search_text`, `search_semantic`, `search` (RRF).
- **Integration:** `upsert` changes body → new results; `delete` removes; rename
  reuses cached embedding.
- **Integration:** watchdog fires `upsert` on external file write.
- **Git (litellm mocked):** `db.write`/`db.remove` create one commit scoped to
  the changed file, with the `Co-Authored-By: <commit_model>` trailer; litellm
  failure → deterministic fallback message but the commit still lands; `db.upsert`
  (watchdog path) creates **no** commit.
- **Cache persistence:** two `MarkdownDB` instances across a restart skip
  re-embed (assert embed called 0 times).
- Embeddings mocked in most tests (deterministic fake vectors); one real-model
  smoke test marked `slow`.

## Dependencies

- `markdowndb`: duckdb, pyyaml, fastembed, watchdog, pydantic, markdown-it-py,
  gitpython, litellm, opentelemetry-api
- `pkm` (MCP server + config): + fastmcp, pydantic-settings,
  opentelemetry-sdk, opentelemetry-exporter-otlp

## Out of scope (YAGNI)

- HTTP/REST service. (A `markdowndb lint` CLI *is* in scope, for prek.)
- Link validation beyond relative Markdown links: wikilinks, heading anchors,
  and external-URL liveness are not checked.
- Promoting `status`/`created`/`updated`/`title` to typed columns (kept in
  `extra`; promote later only if a query proves slow).
- Hybrid score weighting/tuning knobs beyond RRF's fixed `k`.
- Multi-vault support.
