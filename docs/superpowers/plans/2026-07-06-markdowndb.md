# markdowndb Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `pkm.markdowndb` — an in-memory DuckDB-backed index over a CommonMark+YAML vault with FTS, semantic, and hybrid search, git auto-commit with AI messages, and validation.

**Architecture:** `MarkdownDB` class wraps an in-memory DuckDB with attached persistent embedding cache. Reads are query-only; writes (`write`/`remove`) reindex and auto-commit via GitPython+litellm. `pkm.config` reads `pkm.yaml` via pydantic-settings and constructs the DB. MCP tools wrap `MarkdownDB`.

**Tech Stack:** Python 3.13, DuckDB (fts/vss extensions), fastembed (ONNX), GitPython, litellm, pydantic v2, pydantic-settings, markdown-it-py, watchdog, opentelemetry-api, fastmcp.

---

## Branch

Implement on a new branch off `main`:

```bash
git checkout main
git checkout -b impl/markdowndb
```

---

## File Map

| File | Responsibility |
|------|---------------|
| `src/pkm/markdowndb/__init__.py` | Public exports: `MarkdownDB`, `Note`, `Frontmatter`, `SearchHit`, `Violation`, `ValidationReport`, `MarkdownParseError`, `find_vault_root` |
| `src/pkm/markdowndb/models.py` | All pydantic models and `MarkdownParseError` |
| `src/pkm/markdowndb/parse.py` | `split_frontmatter`, `parse_note`, `extract_links` |
| `src/pkm/markdowndb/schema.py` | DuckDB DDL strings and setup helpers |
| `src/pkm/markdowndb/filter.py` | `build_filter_sql()` — filter DSL → parameterised SQL |
| `src/pkm/markdowndb/embed.py` | `EmbeddingCache`, `embed_texts()` |
| `src/pkm/markdowndb/vault_git.py` | `find_vault_root()`, `VaultGit` (stage/diff/commit/litellm) |
| `src/pkm/markdowndb/watcher.py` | `start_watcher()` |
| `src/pkm/markdowndb/validation.py` | `validate_file()`, `validate_links()` |
| `src/pkm/markdowndb/cli.py` | `markdowndb lint` entry point |
| `src/pkm/markdowndb/db.py` | `MarkdownDB` — orchestrates all of the above |
| `src/pkm/config.py` | `PkmSettings`, `load_settings()` |
| `src/pkm/mcp/server.py` | FastMCP tools (extend existing file) |
| `tests/pkm/markdowndb/conftest.py` | `vault` and `db` pytest fixtures |
| `tests/pkm/markdowndb/test_models.py` | Model unit tests |
| `tests/pkm/markdowndb/test_parse.py` | Parse unit tests |
| `tests/pkm/markdowndb/test_filter.py` | Filter DSL unit tests |
| `tests/pkm/markdowndb/test_embed.py` | EmbeddingCache unit tests |
| `tests/pkm/markdowndb/test_db.py` | MarkdownDB integration tests |
| `tests/pkm/markdowndb/test_validation.py` | Validation unit + integration |
| `tests/pkm/markdowndb/test_vault_git.py` | VaultGit unit tests (litellm mocked) |
| `tests/pkm/markdowndb/test_watcher.py` | Watchdog integration test |
| `tests/pkm/test_config.py` | PkmSettings unit tests |

---

## Task 1: Dependencies + package scaffold

**Files:**
- Modify: `pyproject.toml`
- Create: `src/pkm/markdowndb/__init__.py`
- Create: `tests/__init__.py`, `tests/pkm/__init__.py`, `tests/pkm/markdowndb/__init__.py`

- [ ] **Step 1: Update pyproject.toml**

Replace the `dependencies` and add `[project.scripts]` and `[tool.pytest.ini_options]`:

```toml
[project]
name = "pkm"
version = "0.1.0"
description = "Personal Knowledge Management"
readme = "README.md"
license = "AGPL-3.0-or-later"
license-files = ["LICENSE"]
requires-python = ">=3.13"
dependencies = [
    "fastmcp>=2.0",
    "duckdb>=1.1",
    "pyyaml>=6",
    "fastembed>=0.4",
    "watchdog>=4",
    "pydantic>=2",
    "pydantic-settings[yaml]>=2.3",
    "markdown-it-py>=3",
    "gitpython>=3.1",
    "litellm>=1.40",
    "opentelemetry-api>=1.25",
    "opentelemetry-sdk>=1.25",
    "opentelemetry-exporter-otlp>=1.25",
]

[project.optional-dependencies]
dev = ["pytest>=8", "pytest-mock>=3"]

[project.scripts]
pkm-mcp = "pkm.mcp.server:main"
markdowndb = "pkm.markdowndb.cli:main"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/pkm"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

- [ ] **Step 2: Create package stubs**

```bash
mkdir -p src/pkm/markdowndb tests/pkm/markdowndb
touch src/pkm/markdowndb/__init__.py
touch tests/__init__.py tests/pkm/__init__.py tests/pkm/markdowndb/__init__.py
```

- [ ] **Step 3: Sync deps**

```bash
uv sync --extra dev
```

Expected: resolves without error. `uv run python -c "import duckdb, fastembed, git, litellm"` — no ImportError.

- [ ] **Step 4: Commit**

```bash
git add pyproject.toml src/pkm/markdowndb/__init__.py tests/
git commit -m "feat: add markdowndb package scaffold and deps"
```

---

## Task 2: Models

**Files:**
- Create: `src/pkm/markdowndb/models.py`
- Create: `tests/pkm/markdowndb/test_models.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/pkm/markdowndb/test_models.py
import pytest
from pkm.markdowndb.models import (
    Frontmatter, Note, SearchHit, Violation, ValidationReport, MarkdownParseError
)


def test_frontmatter_expected_fields() -> None:
    fm = Frontmatter.model_validate({"id": "n1", "tags": ["a", "b"], "aliases": ["n-one"]})
    assert fm.id == "n1"
    assert fm.tags == ["a", "b"]
    assert fm.aliases == ["n-one"]


def test_frontmatter_extra_fields_preserved() -> None:
    fm = Frontmatter.model_validate({"id": "n1", "status": "open", "weight_kg": 80})
    assert fm.model_extra == {"status": "open", "weight_kg": 80}


def test_frontmatter_defaults() -> None:
    fm = Frontmatter.model_validate({})
    assert fm.id is None
    assert fm.tags == []
    assert fm.aliases == []


def test_note_fields() -> None:
    fm = Frontmatter.model_validate({})
    n = Note(path="a.md", frontmatter=fm, body="hello", mtime=1.0, file_hash="aaa", body_hash="bbb")
    assert n.path == "a.md"


def test_search_hit() -> None:
    fm = Frontmatter.model_validate({})
    n = Note(path="a.md", frontmatter=fm, body="hello", mtime=1.0, file_hash="aaa", body_hash="bbb")
    hit = SearchHit(note=n, score=0.9, snippet="hello")
    assert hit.snippet == "hello"
    hit2 = SearchHit(note=n, score=0.5)
    assert hit2.snippet is None


def test_violation_and_report() -> None:
    v = Violation(path="a.md", check="yaml", message="bad yaml", line=3)
    report = ValidationReport(violations=[v])
    assert not report.ok
    assert ValidationReport(violations=[]).ok


def test_markdown_parse_error() -> None:
    err = MarkdownParseError(path="a.md", line=5, message="bad yaml")
    assert err.path == "a.md"
    assert err.line == 5
    assert isinstance(err, Exception)
```

- [ ] **Step 2: Run to verify failure**

```bash
uv run pytest tests/pkm/markdowndb/test_models.py -v
```

Expected: `ModuleNotFoundError: No module named 'pkm.markdowndb.models'`

- [ ] **Step 3: Implement models.py**

```python
# src/pkm/markdowndb/models.py
from typing import Literal
from pydantic import BaseModel, ConfigDict


class MarkdownParseError(Exception):
    def __init__(self, path: str, message: str, line: int | None = None) -> None:
        super().__init__(f"{path}:{line}: {message}" if line else f"{path}: {message}")
        self.path = path
        self.line = line
        self.message = message


class Frontmatter(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str | None = None
    tags: list[str] = []
    aliases: list[str] = []


class Note(BaseModel):
    path: str
    frontmatter: Frontmatter
    body: str
    mtime: float
    file_hash: str
    body_hash: str


class SearchHit(BaseModel):
    note: Note
    score: float
    snippet: str | None = None


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

- [ ] **Step 4: Run tests**

```bash
uv run pytest tests/pkm/markdowndb/test_models.py -v
```

Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pkm/markdowndb/models.py tests/pkm/markdowndb/test_models.py
git commit -m "feat: add markdowndb models"
```

---

## Task 3: Parse layer

**Files:**
- Create: `src/pkm/markdowndb/parse.py`
- Create: `tests/pkm/markdowndb/test_parse.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/pkm/markdowndb/test_parse.py
import hashlib
import pytest
from pkm.markdowndb.models import MarkdownParseError
from pkm.markdowndb.parse import split_frontmatter, parse_note, extract_links


def test_split_with_frontmatter() -> None:
    text = "---\nid: n1\ntags: [a]\n---\nHello world"
    fm_dict, body = split_frontmatter(text)
    assert fm_dict == {"id": "n1", "tags": ["a"]}
    assert body == "Hello world"


def test_split_without_frontmatter() -> None:
    text = "Just a body"
    fm_dict, body = split_frontmatter(text)
    assert fm_dict == {}
    assert body == "Just a body"


def test_split_empty_frontmatter() -> None:
    text = "---\n---\nBody"
    fm_dict, body = split_frontmatter(text)
    assert fm_dict == {}
    assert body == "Body"


def test_split_frontmatter_not_mapping_raises(tmp_path) -> None:
    text = "---\n- item\n---\nBody"
    with pytest.raises(MarkdownParseError) as exc:
        split_frontmatter(text)
    assert exc.value.path == "<inline>"


def test_split_bad_yaml_raises() -> None:
    text = "---\n: bad: yaml:\n---\nBody"
    with pytest.raises(MarkdownParseError):
        split_frontmatter(text)


def test_parse_note(tmp_path) -> None:
    p = tmp_path / "note.md"
    p.write_text("---\nid: n1\n---\nHello")
    p.stat()
    note = parse_note("note.md", p.read_text(), p.stat().st_mtime)
    assert note.path == "note.md"
    assert note.frontmatter.id == "n1"
    assert note.body == "Hello"
    assert note.body_hash == hashlib.sha256(b"Hello").hexdigest()


def test_extract_links_relative() -> None:
    body = "See [note](../other.md) and [this](sub/file.md)"
    links = extract_links(body)
    assert "../other.md" in links
    assert "sub/file.md" in links


def test_extract_links_ignores_http() -> None:
    body = "See [web](https://example.com) and [mail](mailto:a@b.com)"
    links = extract_links(body)
    assert links == []


def test_extract_links_ignores_anchors() -> None:
    body = "See [section](#heading)"
    links = extract_links(body)
    assert links == []
```

- [ ] **Step 2: Run to verify failure**

```bash
uv run pytest tests/pkm/markdowndb/test_parse.py -v
```

Expected: `ModuleNotFoundError: No module named 'pkm.markdowndb.parse'`

- [ ] **Step 3: Implement parse.py**

```python
# src/pkm/markdowndb/parse.py
import hashlib
from markdown_it import MarkdownIt
import yaml
from pkm.markdowndb.models import Frontmatter, MarkdownParseError, Note

_md = MarkdownIt("commonmark")


def split_frontmatter(text: str, path: str = "<inline>") -> tuple[dict[str, object], str]:
    """Split raw file text into (frontmatter dict, body string). Raises MarkdownParseError."""
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end == -1:
        return {}, text
    raw_fm = text[3:end].strip()
    body = text[end + 4:].lstrip("\n")
    if not raw_fm:
        return {}, body
    try:
        parsed = yaml.safe_load(raw_fm)
    except yaml.YAMLError as e:
        raise MarkdownParseError(path=path, message=str(e)) from e
    if parsed is not None and not isinstance(parsed, dict):
        raise MarkdownParseError(path=path, message="frontmatter must be a YAML mapping")
    return parsed or {}, body


def parse_note(path: str, text: str, mtime: float) -> Note:
    """Parse raw file text into a Note. Raises MarkdownParseError on bad YAML."""
    fm_dict, body = split_frontmatter(text, path=path)
    frontmatter = Frontmatter.model_validate(fm_dict)
    file_hash = hashlib.sha256(text.encode()).hexdigest()
    body_hash = hashlib.sha256(body.encode()).hexdigest()
    return Note(
        path=path,
        frontmatter=frontmatter,
        body=body,
        mtime=mtime,
        file_hash=file_hash,
        body_hash=body_hash,
    )


def extract_links(body: str) -> list[str]:
    """Extract relative link targets from CommonMark body (no http/mailto/anchors)."""
    links: list[str] = []
    for token in _md.parse(body):
        for child in token.children or []:
            if child.type == "link_open":
                href = dict(child.attrs or {}).get("href", "")
                if href and not href.startswith(("http://", "https://", "mailto:", "#")):
                    links.append(href)
    return links
```

- [ ] **Step 4: Run tests**

```bash
uv run pytest tests/pkm/markdowndb/test_parse.py -v
```

Expected: all 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pkm/markdowndb/parse.py tests/pkm/markdowndb/test_parse.py
git commit -m "feat: add frontmatter/CommonMark parse layer"
```

---

## Task 4: Filter DSL

**Files:**
- Create: `src/pkm/markdowndb/filter.py`
- Create: `tests/pkm/markdowndb/test_filter.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/pkm/markdowndb/test_filter.py
from pkm.markdowndb.filter import build_filter_sql


def test_exact_match() -> None:
    sql, params = build_filter_sql({"id": "n1"})
    assert "id = ?" in sql
    assert params == ["n1"]


def test_in_suffix() -> None:
    sql, params = build_filter_sql({"tags__in": ["a", "b"]})
    assert "tags IN (?,?)" in sql
    assert params == ["a", "b"]


def test_contains_suffix() -> None:
    sql, params = build_filter_sql({"tags__contains": "todo"})
    assert "list_contains(tags, ?)" in sql
    assert params == ["todo"]


def test_gte_suffix() -> None:
    sql, params = build_filter_sql({"mtime__gte": 1000.0})
    assert "mtime >= ?" in sql
    assert params == [1000.0]


def test_lte_suffix() -> None:
    sql, params = build_filter_sql({"mtime__lte": 9999.0})
    assert "mtime <= ?" in sql


def test_gt_suffix() -> None:
    sql, params = build_filter_sql({"mtime__gt": 0.0})
    assert "mtime > ?" in sql


def test_lt_suffix() -> None:
    sql, params = build_filter_sql({"mtime__lt": 9999.0})
    assert "mtime < ?" in sql


def test_isnull_true() -> None:
    sql, params = build_filter_sql({"id__isnull": True})
    assert "id IS NULL" in sql
    assert params == []


def test_isnull_false() -> None:
    sql, params = build_filter_sql({"id__isnull": False})
    assert "id IS NOT NULL" in sql


def test_extra_key() -> None:
    sql, params = build_filter_sql({"extra__status": "open"})
    assert "extra->>'status' = ?" in sql
    assert params == ["open"]


def test_multiple_conditions() -> None:
    sql, params = build_filter_sql({"id": "n1", "tags__contains": "todo"})
    assert "AND" in sql
    assert len(params) == 2
```

- [ ] **Step 2: Run to verify failure**

```bash
uv run pytest tests/pkm/markdowndb/test_filter.py -v
```

Expected: `ModuleNotFoundError: No module named 'pkm.markdowndb.filter'`

- [ ] **Step 3: Implement filter.py**

```python
# src/pkm/markdowndb/filter.py

_SUFFIXES = ("__in", "__contains", "__gte", "__lte", "__gt", "__lt", "__isnull")


def build_filter_sql(kwargs: dict[str, object]) -> tuple[str, list[object]]:
    """Translate filter kwargs into a WHERE clause fragment and parameter list."""
    clauses: list[str] = []
    params: list[object] = []

    for key, val in kwargs.items():
        if key.startswith("extra__"):
            field = key[7:]
            clauses.append(f"extra->>'{field}' = ?")
            params.append(val)
        elif key.endswith("__in"):
            col = key[:-4]
            assert isinstance(val, (list, tuple))
            placeholders = ",".join("?" * len(val))
            clauses.append(f"{col} IN ({placeholders})")
            params.extend(val)
        elif key.endswith("__contains"):
            col = key[:-10]
            clauses.append(f"list_contains({col}, ?)")
            params.append(val)
        elif key.endswith("__gte"):
            col = key[:-5]
            clauses.append(f"{col} >= ?")
            params.append(val)
        elif key.endswith("__lte"):
            col = key[:-5]
            clauses.append(f"{col} <= ?")
            params.append(val)
        elif key.endswith("__gt"):
            col = key[:-4]
            clauses.append(f"{col} > ?")
            params.append(val)
        elif key.endswith("__lt"):
            col = key[:-4]
            clauses.append(f"{col} < ?")
            params.append(val)
        elif key.endswith("__isnull"):
            col = key[:-8]
            if val:
                clauses.append(f"{col} IS NULL")
            else:
                clauses.append(f"{col} IS NOT NULL")
        else:
            clauses.append(f"{key} = ?")
            params.append(val)

    return " AND ".join(clauses), params
```

- [ ] **Step 4: Run tests**

```bash
uv run pytest tests/pkm/markdowndb/test_filter.py -v
```

Expected: all 11 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pkm/markdowndb/filter.py tests/pkm/markdowndb/test_filter.py
git commit -m "feat: add filter DSL (Django-style lookup suffixes)"
```

---

## Task 5: DuckDB core (schema, load, get, upsert, delete, sql)

**Files:**
- Create: `src/pkm/markdowndb/schema.py`
- Create: `src/pkm/markdowndb/db.py`
- Create: `tests/pkm/markdowndb/conftest.py`
- Create: `tests/pkm/markdowndb/test_db.py`

- [ ] **Step 1: Write conftest.py**

```python
# tests/pkm/markdowndb/conftest.py
import pytest
import git
from pathlib import Path
from pkm.markdowndb.db import MarkdownDB


@pytest.fixture
def vault(tmp_path: Path) -> Path:
    (tmp_path / "note1.md").write_text(
        "---\nid: n1\ntags: [todo]\n---\nHello world"
    )
    (tmp_path / "note2.md").write_text(
        "---\nid: n2\ntags: [project]\n---\nCollectors fallacy in note taking"
    )
    sub = tmp_path / "sub"
    sub.mkdir()
    (sub / "note3.md").write_text(
        "---\ntags: [project]\n---\nSee [note1](../note1.md)"
    )
    repo = git.Repo.init(tmp_path)
    repo.index.add(["note1.md", "note2.md", "sub/note3.md"])
    repo.config_writer().set_value("user", "name", "Test").release()
    repo.config_writer().set_value("user", "email", "test@test.com").release()
    repo.index.commit("initial")
    return tmp_path


@pytest.fixture
def db(vault: Path) -> MarkdownDB:
    d = MarkdownDB(vault=vault, embed_model=None, watch=False)  # embed_model=None disables embeddings
    d.load()
    return d
```

- [ ] **Step 2: Write failing tests**

```python
# tests/pkm/markdowndb/test_db.py
import pytest
from pathlib import Path
from pkm.markdowndb.db import MarkdownDB
from pkm.markdowndb.models import Note, MarkdownParseError


def test_load_indexes_all_notes(db: MarkdownDB) -> None:
    rows = db.sql("SELECT COUNT(*) FROM notes").fetchone()
    assert rows[0] == 3


def test_get_returns_note(db: MarkdownDB) -> None:
    note = db.get("note1.md")
    assert note is not None
    assert note.frontmatter.id == "n1"
    assert note.body == "Hello world"


def test_get_missing_returns_none(db: MarkdownDB) -> None:
    assert db.get("missing.md") is None


def test_filter_exact(db: MarkdownDB) -> None:
    results = db.filter(id="n1")
    assert len(results) == 1
    assert results[0].path == "note1.md"


def test_filter_contains(db: MarkdownDB) -> None:
    results = db.filter(tags__contains="todo")
    assert len(results) == 1
    assert results[0].frontmatter.id == "n1"


def test_filter_in(db: MarkdownDB) -> None:
    results = db.filter(tags__in=["todo", "project"])
    assert len(results) == 3


def test_upsert_updates_note(db: MarkdownDB, vault: Path) -> None:
    (vault / "note1.md").write_text("---\nid: n1\ntags: [done]\n---\nUpdated body")
    db.upsert("note1.md")
    note = db.get("note1.md")
    assert note is not None
    assert note.frontmatter.tags == ["done"]
    assert note.body == "Updated body"


def test_upsert_noop_when_hash_unchanged(db: MarkdownDB, vault: Path) -> None:
    # Touch mtime but not content — upsert should detect unchanged file_hash
    import time
    time.sleep(0.01)
    text = (vault / "note1.md").read_text()
    (vault / "note1.md").write_text(text)  # same content, new mtime
    # No exception, no crash
    db.upsert("note1.md")
    assert db.get("note1.md") is not None


def test_delete_removes_note(db: MarkdownDB, vault: Path) -> None:
    db.delete("note1.md")
    assert db.get("note1.md") is None
    rows = db.sql("SELECT COUNT(*) FROM notes").fetchone()
    assert rows[0] == 2


def test_load_raises_on_bad_yaml(tmp_path: Path) -> None:
    import git
    (tmp_path / "bad.md").write_text("---\n: bad:\n---\nBody")
    repo = git.Repo.init(tmp_path)
    repo.config_writer().set_value("user", "name", "Test").release()
    repo.config_writer().set_value("user", "email", "test@test.com").release()
    repo.index.add(["bad.md"])
    repo.index.commit("init")
    d = MarkdownDB(vault=tmp_path, embed_model=None, watch=False)
    with pytest.raises(MarkdownParseError):
        d.load()
```

- [ ] **Step 3: Run to verify failure**

```bash
uv run pytest tests/pkm/markdowndb/test_db.py -v
```

Expected: `ModuleNotFoundError: No module named 'pkm.markdowndb.db'`

- [ ] **Step 4: Implement schema.py**

```python
# src/pkm/markdowndb/schema.py
NOTES_DDL = """
CREATE TABLE notes (
    path         VARCHAR PRIMARY KEY,
    file_hash    VARCHAR NOT NULL,
    body_hash    VARCHAR NOT NULL,
    mtime        DOUBLE  NOT NULL,
    id           VARCHAR,
    tags         VARCHAR[],
    aliases      VARCHAR[],
    extra        JSON,
    body         VARCHAR NOT NULL
)
"""

EMBEDDINGS_DDL = """
CREATE TABLE embeddings (
    path      VARCHAR PRIMARY KEY,
    embedding FLOAT[384]
)
"""

EMBEDDING_CACHE_DDL = """
CREATE TABLE IF NOT EXISTS embedding_cache (
    body_hash VARCHAR PRIMARY KEY,
    model     VARCHAR NOT NULL,
    embedding FLOAT[384]
)
"""
```

- [ ] **Step 5: Implement db.py (core — no embedding, no FTS, no git yet)**

```python
# src/pkm/markdowndb/db.py
import json
import logging
from pathlib import Path
from typing import Any

import duckdb

from pkm.markdowndb.filter import build_filter_sql
from pkm.markdowndb.models import Frontmatter, Note
from pkm.markdowndb.parse import parse_note
from pkm.markdowndb.schema import EMBEDDINGS_DDL, EMBEDDING_CACHE_DDL, NOTES_DDL

logger = logging.getLogger(__name__)


def _row_to_note(row: tuple[Any, ...]) -> Note:
    # columns: path, file_hash, body_hash, mtime, id, tags, aliases, extra, body
    path, file_hash, body_hash, mtime, nid, tags, aliases, extra, body = row
    extra_dict: dict[str, object] = json.loads(extra) if extra else {}
    fm = Frontmatter.model_validate(
        {"id": nid, "tags": tags or [], "aliases": aliases or [], **extra_dict}
    )
    return Note(path=path, frontmatter=fm, body=body, mtime=mtime,
                file_hash=file_hash, body_hash=body_hash)


class MarkdownDB:
    def __init__(
        self,
        vault: Path | str,
        embed_model: str | None = "BAAI/bge-small-en-v1.5",
        watch: bool = True,
        cache_dir: Path | None = None,
        commit_model: str = "openrouter/free",
    ) -> None:
        self._vault = Path(vault).expanduser()
        self._embed_model = embed_model
        self._watch = watch
        self._cache_dir = cache_dir or (self._vault / ".markdowndb")
        self._commit_model = commit_model
        self._conn: duckdb.DuckDBPyConnection = duckdb.connect(":memory:")
        self._conn.execute("INSTALL json; LOAD json;")
        self._conn.execute(NOTES_DDL)
        self._conn.execute(EMBEDDINGS_DDL)
        self._watcher: object | None = None

    def load(self) -> None:
        """Scan vault, parse every .md, index all notes. Idempotent (clears first)."""
        self._conn.execute("DELETE FROM notes")
        for md_file in sorted(self._vault.rglob("*.md")):
            rel = str(md_file.relative_to(self._vault))
            text = md_file.read_text(encoding="utf-8")
            note = parse_note(rel, text, md_file.stat().st_mtime)
            self._insert_note(note)
        if self._watch:
            self._start_watcher()

    def _insert_note(self, note: Note) -> None:
        extra = json.dumps(note.frontmatter.model_extra or {})
        self._conn.execute(
            "INSERT OR REPLACE INTO notes VALUES (?,?,?,?,?,?,?,?,?)",
            [note.path, note.file_hash, note.body_hash, note.mtime,
             note.frontmatter.id, note.frontmatter.tags,
             note.frontmatter.aliases, extra, note.body],
        )

    def get(self, path: str) -> Note | None:
        row = self._conn.execute(
            "SELECT * FROM notes WHERE path = ?", [path]
        ).fetchone()
        return _row_to_note(row) if row else None

    def filter(self, **kwargs: object) -> list[Note]:
        if not kwargs:
            rows = self._conn.execute("SELECT * FROM notes").fetchall()
            return [_row_to_note(r) for r in rows]
        where, params = build_filter_sql(kwargs)
        rows = self._conn.execute(f"SELECT * FROM notes WHERE {where}", params).fetchall()
        return [_row_to_note(r) for r in rows]

    def sql(self, query: str, params: list[object] | None = None) -> duckdb.DuckDBPyRelation:
        return self._conn.execute(query, params or [])

    def upsert(self, path: str) -> None:
        """Reindex one file (no git). Used by watchdog and internally."""
        md_file = self._vault / path
        if not md_file.exists():
            self.delete(path)
            return
        text = md_file.read_text(encoding="utf-8")
        note = parse_note(path, text, md_file.stat().st_mtime)
        # Check if file_hash changed
        existing = self._conn.execute(
            "SELECT file_hash FROM notes WHERE path = ?", [path]
        ).fetchone()
        if existing and existing[0] == note.file_hash:
            self._conn.execute("UPDATE notes SET mtime = ? WHERE path = ?", [note.mtime, path])
            return
        self._insert_note(note)

    def delete(self, path: str) -> None:
        """Remove from index (no git)."""
        self._conn.execute("DELETE FROM notes WHERE path = ?", [path])
        self._conn.execute("DELETE FROM embeddings WHERE path = ?", [path])

    def _start_watcher(self) -> None:
        from pkm.markdowndb.watcher import start_watcher
        self._watcher = start_watcher(self._vault, self.upsert)

    def close(self) -> None:
        if self._watcher is not None:
            self._watcher.stop()  # type: ignore[attr-defined]
            self._watcher.join()  # type: ignore[attr-defined]
        self._conn.close()
```

- [ ] **Step 6: Run tests**

```bash
uv run pytest tests/pkm/markdowndb/test_db.py -v
```

Expected: all 10 tests PASS (watcher import will fail if watcher.py missing — keep `watch=False` in fixture).

- [ ] **Step 7: Commit**

```bash
git add src/pkm/markdowndb/schema.py src/pkm/markdowndb/db.py tests/pkm/markdowndb/conftest.py tests/pkm/markdowndb/test_db.py
git commit -m "feat: DuckDB core (load, get, filter, upsert, delete, sql)"
```

---

## Task 6: FTS search

**Files:**
- Modify: `src/pkm/markdowndb/db.py`
- Modify: `tests/pkm/markdowndb/test_db.py`

- [ ] **Step 1: Write failing test**

Add to `tests/pkm/markdowndb/test_db.py`:

```python
def test_search_text(db: MarkdownDB) -> None:
    hits = db.search_text("collectors fallacy", limit=5)
    assert len(hits) >= 1
    assert hits[0].note.path == "note2.md"
    assert hits[0].score > 0


def test_search_text_no_results(db: MarkdownDB) -> None:
    hits = db.search_text("xyzzy impossible query", limit=5)
    assert hits == []
```

- [ ] **Step 2: Run to verify failure**

```bash
uv run pytest tests/pkm/markdowndb/test_db.py::test_search_text -v
```

Expected: `AttributeError: 'MarkdownDB' object has no attribute 'search_text'`

- [ ] **Step 3: Add FTS to db.py**

In `MarkdownDB.load()`, after all notes are inserted, add:

```python
self._conn.execute("INSTALL fts; LOAD fts;")
self._conn.execute(
    "PRAGMA create_fts_index('notes', 'path', 'body', stemmer='porter', "
    "stopwords='english', ignore='(\\.|[^a-z])+', strip_accents=1, lower=1, overwrite=1)"
)
```

Add `_rebuild_fts()` helper called after `_insert_note` in `upsert`:

```python
def _rebuild_fts(self) -> None:
    # ponytail: full FTS rebuild on each upsert; acceptable at 100k, add incremental if DuckDB supports it
    self._conn.execute(
        "PRAGMA create_fts_index('notes', 'path', 'body', stemmer='porter', "
        "stopwords='english', ignore='(\\.|[^a-z])+', strip_accents=1, lower=1, overwrite=1)"
    )
```

Call `self._rebuild_fts()` at the end of `upsert` (when file_hash changed).

Add `search_text` method:

```python
from pkm.markdowndb.models import SearchHit

def search_text(self, query: str, limit: int = 10) -> list[SearchHit]:
    rows = self._conn.execute(
        "SELECT *, fts_main_notes.match_bm25(path, ?) AS score "
        "FROM notes WHERE score IS NOT NULL ORDER BY score DESC LIMIT ?",
        [query, limit],
    ).fetchall()
    hits = []
    for row in rows:
        # row has notes cols + score appended
        note = _row_to_note(row[:9])
        score: float = row[9]
        hits.append(SearchHit(note=note, score=score))
    return hits
```

Also add FTS init to `__init__` (in case load not called yet):

```python
self._conn.execute("INSTALL fts; LOAD fts;")
```

- [ ] **Step 4: Run tests**

```bash
uv run pytest tests/pkm/markdowndb/test_db.py -v
```

Expected: all tests including `test_search_text` PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pkm/markdowndb/db.py tests/pkm/markdowndb/test_db.py
git commit -m "feat: add FTS search (DuckDB fts extension, BM25)"
```

---

## Task 7: Embedding cache

**Files:**
- Create: `src/pkm/markdowndb/embed.py`
- Create: `tests/pkm/markdowndb/test_embed.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/pkm/markdowndb/test_embed.py
import numpy as np
import pytest
import duckdb
from pkm.markdowndb.embed import EmbeddingCache


@pytest.fixture
def cache(tmp_path) -> EmbeddingCache:
    conn = duckdb.connect(str(tmp_path / "cache.duckdb"))
    return EmbeddingCache(conn=conn, model="test-model")


def test_put_and_get(cache: EmbeddingCache) -> None:
    vec = np.zeros(384, dtype=np.float32)
    cache.put("hash1", vec)
    result = cache.get("hash1")
    assert result is not None
    assert result.shape == (384,)


def test_get_missing_returns_none(cache: EmbeddingCache) -> None:
    assert cache.get("nonexistent") is None


def test_get_wrong_model_returns_none(tmp_path) -> None:
    conn = duckdb.connect(str(tmp_path / "c.duckdb"))
    c1 = EmbeddingCache(conn=conn, model="model-a")
    vec = np.ones(384, dtype=np.float32)
    c1.put("h1", vec)
    c2 = EmbeddingCache(conn=conn, model="model-b")
    assert c2.get("h1") is None


def test_missing_hashes(cache: EmbeddingCache) -> None:
    vec = np.ones(384, dtype=np.float32)
    cache.put("h1", vec)
    missing = cache.missing_hashes(["h1", "h2", "h3"])
    assert missing == ["h2", "h3"]
```

- [ ] **Step 2: Run to verify failure**

```bash
uv run pytest tests/pkm/markdowndb/test_embed.py -v
```

Expected: `ModuleNotFoundError: No module named 'pkm.markdowndb.embed'`

- [ ] **Step 3: Implement embed.py**

```python
# src/pkm/markdowndb/embed.py
import logging
import numpy as np
import duckdb
from pkm.markdowndb.schema import EMBEDDING_CACHE_DDL

logger = logging.getLogger(__name__)


class EmbeddingCache:
    def __init__(self, conn: duckdb.DuckDBPyConnection, model: str) -> None:
        self._conn = conn
        self._model = model
        conn.execute(EMBEDDING_CACHE_DDL)

    def get(self, body_hash: str) -> np.ndarray | None:
        row = self._conn.execute(
            "SELECT embedding FROM embedding_cache WHERE body_hash = ? AND model = ?",
            [body_hash, self._model],
        ).fetchone()
        if row is None:
            return None
        return np.array(row[0], dtype=np.float32)

    def put(self, body_hash: str, vec: np.ndarray) -> None:
        self._conn.execute(
            "INSERT OR REPLACE INTO embedding_cache VALUES (?, ?, ?)",
            [body_hash, self._model, vec.tolist()],
        )

    def missing_hashes(self, hashes: list[str]) -> list[str]:
        if not hashes:
            return []
        placeholders = ",".join("?" * len(hashes))
        found = {
            row[0]
            for row in self._conn.execute(
                f"SELECT body_hash FROM embedding_cache WHERE body_hash IN ({placeholders}) AND model = ?",
                hashes + [self._model],
            ).fetchall()
        }
        return [h for h in hashes if h not in found]


def embed_texts(texts: list[str], model_name: str) -> list[np.ndarray]:
    """Embed a list of texts using fastembed. Returns one ndarray per text."""
    from fastembed import TextEmbedding
    model = TextEmbedding(model_name=model_name)
    return list(model.embed(texts))
```

- [ ] **Step 4: Run tests**

```bash
uv run pytest tests/pkm/markdowndb/test_embed.py -v
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pkm/markdowndb/embed.py tests/pkm/markdowndb/test_embed.py
git commit -m "feat: add embedding cache (DuckDB-backed, keyed by body_hash)"
```

---

## Task 8: Semantic search + hybrid (RRF)

**Files:**
- Modify: `src/pkm/markdowndb/db.py`
- Modify: `tests/pkm/markdowndb/test_db.py`

The `embed_model=None` in conftest skips embeddings. These tests use a real model — mark `@pytest.mark.slow`.

- [ ] **Step 1: Write failing tests**

Add to `tests/pkm/markdowndb/test_db.py`:

```python
import pytest

@pytest.mark.slow
def test_search_semantic(vault) -> None:
    from pkm.markdowndb.db import MarkdownDB
    d = MarkdownDB(vault=vault, embed_model="BAAI/bge-small-en-v1.5", watch=False)
    d.load()
    hits = d.search_semantic("note taking philosophy", k=5)
    assert len(hits) >= 1
    assert all(h.score >= 0 for h in hits)
    d.close()


@pytest.mark.slow
def test_search_hybrid(vault) -> None:
    from pkm.markdowndb.db import MarkdownDB
    d = MarkdownDB(vault=vault, embed_model="BAAI/bge-small-en-v1.5", watch=False)
    d.load()
    hits = d.search("collectors fallacy", limit=5)
    assert len(hits) >= 1
    d.close()
```

- [ ] **Step 2: Run to verify failure**

```bash
uv run pytest tests/pkm/markdowndb/test_db.py::test_search_semantic -v -m slow
```

Expected: `AttributeError: 'MarkdownDB' object has no attribute 'search_semantic'`

- [ ] **Step 3: Extend db.py with embedding + semantic + hybrid**

Add to `MarkdownDB.__init__`:

```python
self._cache_conn: duckdb.DuckDBPyConnection | None = None
self._embed_cache: "EmbeddingCache | None" = None
if embed_model:
    self._cache_dir.mkdir(parents=True, exist_ok=True)
    self._cache_conn = duckdb.connect(str(self._cache_dir / "cache.duckdb"))
    from pkm.markdowndb.embed import EmbeddingCache
    self._embed_cache = EmbeddingCache(conn=self._cache_conn, model=embed_model)
    self._conn.execute("INSTALL vss; LOAD vss;")
```

Add `_load_embeddings()` called at end of `load()` when embed_model is set:

```python
def _load_embeddings(self) -> None:
    if self._embed_cache is None or self._embed_model is None:
        return
    from pkm.markdowndb.embed import embed_texts
    rows = self._conn.execute("SELECT path, body_hash, body FROM notes").fetchall()
    hashes = [r[1] for r in rows]
    missing_hashes = self._embed_cache.missing_hashes(hashes)
    if missing_hashes:
        missing_bodies = [r[2] for r in rows if r[1] in set(missing_hashes)]
        vecs = embed_texts(missing_bodies, self._embed_model)
        for h, vec in zip(missing_hashes, vecs):
            self._embed_cache.put(h, vec)
    # Load all embeddings into in-memory table
    self._conn.execute("DELETE FROM embeddings")
    for path, body_hash, _ in rows:
        vec = self._embed_cache.get(body_hash)
        if vec is not None:
            self._conn.execute(
                "INSERT INTO embeddings VALUES (?, ?)", [path, vec.tolist()]
            )
    self._conn.execute("CREATE INDEX IF NOT EXISTS emb_idx ON embeddings USING HNSW (embedding)")
```

Add `search_semantic` and `search` methods:

```python
def search_semantic(self, query: str, k: int = 10) -> list[SearchHit]:
    if self._embed_cache is None or self._embed_model is None:
        logger.warning("semantic search unavailable: no embed_model")
        return []
    from pkm.markdowndb.embed import embed_texts
    q_vec = embed_texts([query], self._embed_model)[0]
    rows = self._conn.execute(
        "SELECT e.path, array_distance(e.embedding, ?::FLOAT[384]) AS dist "
        "FROM embeddings e ORDER BY dist ASC LIMIT ?",
        [q_vec.tolist(), k],
    ).fetchall()
    hits = []
    for path, dist in rows:
        note = self.get(path)
        if note:
            hits.append(SearchHit(note=note, score=float(1.0 / (1.0 + dist))))
    return hits


def search(self, query: str, limit: int = 10) -> list[SearchHit]:
    """Hybrid search: RRF fusion of FTS and semantic results."""
    fts_hits = self.search_text(query, limit=limit * 2)
    sem_hits = self.search_semantic(query, k=limit * 2)
    # RRF
    k = 60
    scores: dict[str, float] = {}
    for rank, hit in enumerate(fts_hits):
        scores[hit.note.path] = scores.get(hit.note.path, 0.0) + 1.0 / (k + rank + 1)
    for rank, hit in enumerate(sem_hits):
        scores[hit.note.path] = scores.get(hit.note.path, 0.0) + 1.0 / (k + rank + 1)
    ranked = sorted(scores.items(), key=lambda x: x[1], reverse=True)[:limit]
    result = []
    for path, score in ranked:
        note = self.get(path)
        if note:
            result.append(SearchHit(note=note, score=score))
    return result
```

Update `close()` to also close `_cache_conn`:

```python
def close(self) -> None:
    if self._watcher is not None:
        self._watcher.stop()  # type: ignore[attr-defined]
        self._watcher.join()  # type: ignore[attr-defined]
    if self._cache_conn is not None:
        self._cache_conn.close()
    self._conn.close()
```

- [ ] **Step 4: Run slow tests**

```bash
uv run pytest tests/pkm/markdowndb/test_db.py -v -m slow
```

Expected: PASS (may download model on first run — that's fine).

- [ ] **Step 5: Commit**

```bash
git add src/pkm/markdowndb/db.py tests/pkm/markdowndb/test_db.py
git commit -m "feat: add semantic search (fastembed+VSS) and hybrid RRF"
```

---

## Task 9: Validation + lint CLI

**Files:**
- Create: `src/pkm/markdowndb/validation.py`
- Create: `src/pkm/markdowndb/cli.py`
- Create: `tests/pkm/markdowndb/test_validation.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/pkm/markdowndb/test_validation.py
import pytest
from pathlib import Path
from pkm.markdowndb.db import MarkdownDB
from pkm.markdowndb.models import MarkdownParseError, ValidationReport
from pkm.markdowndb.validation import validate_file, validate_links


def test_validate_file_valid(tmp_path: Path) -> None:
    p = tmp_path / "good.md"
    p.write_text("---\nid: n1\n---\nHello world")
    violations = validate_file("good.md", p.read_text())
    assert violations == []


def test_validate_file_bad_yaml(tmp_path: Path) -> None:
    p = tmp_path / "bad.md"
    p.write_text("---\n: bad:\n---\nBody")
    violations = validate_file("bad.md", p.read_text())
    assert len(violations) == 1
    assert violations[0].check == "yaml"


def test_validate_links_valid(tmp_path: Path) -> None:
    (tmp_path / "other.md").write_text("# Other")
    note_dir = tmp_path
    violations = validate_links("note.md", "[other](other.md)", note_dir)
    assert violations == []


def test_validate_links_broken(tmp_path: Path) -> None:
    violations = validate_links("note.md", "[missing](missing.md)", tmp_path)
    assert len(violations) == 1
    assert violations[0].check == "links"
    assert "missing.md" in violations[0].message


def test_validate_links_ignores_http(tmp_path: Path) -> None:
    violations = validate_links("note.md", "[web](https://example.com)", tmp_path)
    assert violations == []


def test_db_validate_collects_all(tmp_path: Path) -> None:
    import git
    (tmp_path / "good.md").write_text("---\nid: n1\n---\nHello")
    (tmp_path / "bad.md").write_text("---\n: bad:\n---\nBody")
    repo = git.Repo.init(tmp_path)
    repo.config_writer().set_value("user", "name", "Test").release()
    repo.config_writer().set_value("user", "email", "test@test.com").release()
    repo.index.add(["good.md", "bad.md"])
    repo.index.commit("init")
    # load raises on bad.md
    d = MarkdownDB(vault=tmp_path, embed_model=None, watch=False)
    with pytest.raises(MarkdownParseError):
        d.load()
    # validate collects without raising
    report = d.validate()
    assert not report.ok
    assert any(v.check == "yaml" for v in report.violations)
```

- [ ] **Step 2: Run to verify failure**

```bash
uv run pytest tests/pkm/markdowndb/test_validation.py -v
```

Expected: `ModuleNotFoundError: No module named 'pkm.markdowndb.validation'`

- [ ] **Step 3: Implement validation.py**

```python
# src/pkm/markdowndb/validation.py
from pathlib import Path
from pkm.markdowndb.models import Violation
from pkm.markdowndb.parse import split_frontmatter, extract_links


def validate_file(path: str, text: str) -> list[Violation]:
    """Run yaml + commonmark checks. Returns violations (never raises)."""
    violations: list[Violation] = []
    try:
        split_frontmatter(text, path=path)
    except Exception as e:
        violations.append(Violation(path=path, check="yaml", message=str(e)))
    return violations


def validate_links(path: str, body: str, note_dir: Path) -> list[Violation]:
    """Check all relative links in body resolve under note_dir."""
    violations: list[Violation] = []
    for href in extract_links(body):
        target = (note_dir / href).resolve()
        if not target.exists():
            violations.append(Violation(
                path=path, check="links",
                message=f"broken link: {href} -> {target} does not exist",
            ))
    return violations
```

Add `validate()` method to `MarkdownDB` in `db.py`:

```python
def validate(self, paths: list[str] | None = None) -> ValidationReport:
    """Collect every violation across yaml/commonmark/links without raising."""
    from pkm.markdowndb.models import ValidationReport
    from pkm.markdowndb.validation import validate_file, validate_links
    violations = []
    candidates = paths or [str(p.relative_to(self._vault)) for p in self._vault.rglob("*.md")]
    for rel in candidates:
        md_file = self._vault / rel
        try:
            text = md_file.read_text(encoding="utf-8")
        except OSError as e:
            from pkm.markdowndb.models import Violation
            violations.append(Violation(path=rel, check="yaml", message=str(e)))
            continue
        violations.extend(validate_file(rel, text))
        try:
            from pkm.markdowndb.parse import split_frontmatter
            _, body = split_frontmatter(text, path=rel)
            violations.extend(validate_links(rel, body, md_file.parent))
        except Exception:
            pass
    return ValidationReport(violations=violations)
```

- [ ] **Step 4: Implement cli.py**

```python
# src/pkm/markdowndb/cli.py
import sys
from pathlib import Path
from pkm.markdowndb.validation import validate_file, validate_links
from pkm.markdowndb.parse import split_frontmatter


def main() -> None:
    paths = sys.argv[1:]
    if not paths:
        sys.exit(0)
    violations = []
    for p in paths:
        path_obj = Path(p)
        try:
            text = path_obj.read_text(encoding="utf-8")
        except OSError as e:
            print(f"{p}: [yaml] {e}")
            violations.append(p)
            continue
        vs = validate_file(p, text)
        try:
            _, body = split_frontmatter(text, path=p)
            from pkm.markdowndb.validation import validate_links
            vs += validate_links(p, body, path_obj.parent)
        except Exception:
            pass
        for v in vs:
            line = f":{v.line}" if v.line else ""
            print(f"{v.path}{line}: [{v.check}] {v.message}")
        violations.extend(vs)
    sys.exit(1 if violations else 0)
```

- [ ] **Step 5: Run tests**

```bash
uv run pytest tests/pkm/markdowndb/test_validation.py -v
```

Expected: all 6 tests PASS.

- [ ] **Step 6: Verify CLI**

```bash
uv run markdowndb lint tests/pkm/markdowndb/conftest.py  # not markdown, should pass
echo "---
: bad:
---
Body" > /tmp/bad.md
uv run markdowndb lint /tmp/bad.md; echo "exit: $?"
```

Expected: prints violation, exits 1.

- [ ] **Step 7: Commit**

```bash
git add src/pkm/markdowndb/validation.py src/pkm/markdowndb/cli.py src/pkm/markdowndb/db.py tests/pkm/markdowndb/test_validation.py
git commit -m "feat: add validation (yaml/links checks) and markdowndb lint CLI"
```

---

## Task 10: Watchdog

**Files:**
- Create: `src/pkm/markdowndb/watcher.py`
- Create: `tests/pkm/markdowndb/test_watcher.py`

- [ ] **Step 1: Write failing test**

```python
# tests/pkm/markdowndb/test_watcher.py
import time
import pytest
from pathlib import Path
from pkm.markdowndb.db import MarkdownDB


def test_watchdog_picks_up_external_edit(vault: Path) -> None:
    db = MarkdownDB(vault=vault, embed_model=None, watch=True)
    db.load()
    # External edit — no git commit expected, just reindex
    (vault / "note1.md").write_text("---\nid: n1\ntags: [modified]\n---\nNew body")
    time.sleep(0.5)  # let watchdog fire
    note = db.get("note1.md")
    assert note is not None
    assert "modified" in note.frontmatter.tags
    db.close()
```

- [ ] **Step 2: Run to verify failure**

```bash
uv run pytest tests/pkm/markdowndb/test_watcher.py -v
```

Expected: `ModuleNotFoundError: No module named 'pkm.markdowndb.watcher'`

- [ ] **Step 3: Implement watcher.py**

```python
# src/pkm/markdowndb/watcher.py
import logging
from pathlib import Path
from typing import Callable
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler, FileSystemEvent

logger = logging.getLogger(__name__)


class _Handler(FileSystemEventHandler):
    def __init__(self, vault: Path, on_change: Callable[[str], None]) -> None:
        self._vault = vault
        self._on_change = on_change

    def _handle(self, path_str: str) -> None:
        path = Path(path_str)
        if path.suffix != ".md":
            return
        try:
            rel = str(path.relative_to(self._vault))
        except ValueError:
            return
        logger.debug("watchdog: %s", rel)
        self._on_change(rel)

    def on_modified(self, event: FileSystemEvent) -> None:
        if not event.is_directory:
            self._handle(str(event.src_path))

    def on_created(self, event: FileSystemEvent) -> None:
        if not event.is_directory:
            self._handle(str(event.src_path))

    def on_deleted(self, event: FileSystemEvent) -> None:
        if not event.is_directory:
            self._handle(str(event.src_path))


def start_watcher(vault: Path, on_change: Callable[[str], None]) -> Observer:
    handler = _Handler(vault, on_change)
    observer = Observer()
    observer.schedule(handler, str(vault), recursive=True)
    observer.start()
    return observer
```

- [ ] **Step 4: Run tests**

```bash
uv run pytest tests/pkm/markdowndb/test_watcher.py -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pkm/markdowndb/watcher.py tests/pkm/markdowndb/test_watcher.py
git commit -m "feat: add watchdog filesystem watcher"
```

---

## Task 11: vault_git + litellm auto-commit

**Files:**
- Create: `src/pkm/markdowndb/vault_git.py`
- Create: `tests/pkm/markdowndb/test_vault_git.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/pkm/markdowndb/test_vault_git.py
import pytest
from pathlib import Path
from unittest.mock import patch
from pkm.markdowndb.vault_git import find_vault_root, VaultGit


def test_find_vault_root(vault: Path) -> None:
    root = find_vault_root(vault)
    assert root == vault


def test_find_vault_root_from_subdir(vault: Path) -> None:
    root = find_vault_root(vault / "sub")
    assert root == vault


def test_find_vault_root_missing_raises(tmp_path: Path) -> None:
    with pytest.raises(RuntimeError, match="git repo"):
        find_vault_root(tmp_path)


def test_commit_write_creates_commit(vault: Path) -> None:
    import git
    vg = VaultGit(vault=vault, commit_model="openrouter/free")
    (vault / "new.md").write_text("---\n---\nNew note")
    with patch("pkm.markdowndb.vault_git._ai_commit_message", return_value="add new.md"):
        vg.commit_paths(["new.md"], action="add")
    repo = git.Repo(vault)
    assert repo.head.commit.message.startswith("add new.md")
    assert "Co-Authored-By:" in repo.head.commit.message


def test_commit_fallback_on_litellm_failure(vault: Path) -> None:
    import git
    vg = VaultGit(vault=vault, commit_model="openrouter/free")
    (vault / "new2.md").write_text("---\n---\nAnother")
    with patch("pkm.markdowndb.vault_git._ai_commit_message", side_effect=Exception("API down")):
        vg.commit_paths(["new2.md"], action="add")
    repo = git.Repo(vault)
    assert "new2.md" in repo.head.commit.message


def test_upsert_does_not_commit(vault: Path) -> None:
    import git
    from pkm.markdowndb.db import MarkdownDB
    d = MarkdownDB(vault=vault, embed_model=None, watch=False)
    d.load()
    before = git.Repo(vault).head.commit.hexsha
    (vault / "note1.md").write_text("---\nid: n1\n---\nChanged via upsert")
    d.upsert("note1.md")
    after = git.Repo(vault).head.commit.hexsha
    assert before == after  # no commit
    d.close()
```

- [ ] **Step 2: Run to verify failure**

```bash
uv run pytest tests/pkm/markdowndb/test_vault_git.py -v
```

Expected: `ModuleNotFoundError: No module named 'pkm.markdowndb.vault_git'`

- [ ] **Step 3: Implement vault_git.py**

```python
# src/pkm/markdowndb/vault_git.py
import logging
from pathlib import Path
import git

logger = logging.getLogger(__name__)


def find_vault_root(start: Path) -> Path:
    """Walk up from start to find the directory containing .git."""
    try:
        repo = git.Repo(start, search_parent_directories=True)
        return Path(repo.working_tree_dir)
    except git.InvalidGitRepositoryError:
        raise RuntimeError(f"No git repo found from {start}") from None


def _ai_commit_message(diff: str, commit_model: str) -> str:
    import litellm
    resp = litellm.completion(
        model=commit_model,
        messages=[{
            "role": "user",
            "content": (
                "Write a single-line git commit message (imperative, ≤72 chars) "
                f"for this diff. Reply with ONLY the message:\n\n{diff}"
            ),
        }],
    )
    return resp.choices[0].message.content.strip()


class VaultGit:
    def __init__(self, vault: Path, commit_model: str) -> None:
        self._vault = vault
        self._commit_model = commit_model
        self._repo = git.Repo(vault)

    def commit_paths(self, paths: list[str], action: str = "update") -> None:
        """Stage paths, generate AI commit message, commit with Co-Authored-By trailer."""
        for p in paths:
            abs_path = self._vault / p
            if abs_path.exists():
                self._repo.index.add([p])
            else:
                try:
                    self._repo.index.remove([p])
                except Exception:
                    pass
        diff = self._repo.git.diff("--cached")
        try:
            subject = _ai_commit_message(diff, self._commit_model)
        except Exception as e:
            logger.warning("litellm failed (%s), using fallback message", e)
            subject = f"{action} {', '.join(paths)}"
        message = f"{subject}\n\nCo-Authored-By: {self._commit_model} <noreply@pkm.local>"
        self._repo.index.commit(message)
```

- [ ] **Step 4: Run tests**

```bash
uv run pytest tests/pkm/markdowndb/test_vault_git.py -v
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pkm/markdowndb/vault_git.py tests/pkm/markdowndb/test_vault_git.py
git commit -m "feat: add vault_git (find_vault_root, VaultGit with AI commit messages)"
```

---

## Task 12: write/remove (MCP mutators)

**Files:**
- Modify: `src/pkm/markdowndb/db.py`
- Modify: `tests/pkm/markdowndb/test_vault_git.py`

- [ ] **Step 1: Write failing tests**

Add to `tests/pkm/markdowndb/test_vault_git.py`:

```python
def test_write_creates_file_indexes_and_commits(vault: Path) -> None:
    import git
    from pkm.markdowndb.db import MarkdownDB
    d = MarkdownDB(vault=vault, embed_model=None, watch=False, commit_model="openrouter/free")
    d.load()
    with patch("pkm.markdowndb.vault_git._ai_commit_message", return_value="add journal.md"):
        d.write("journal.md", "---\n---\nToday's note")
    assert d.get("journal.md") is not None
    repo = git.Repo(vault)
    assert "journal.md" in repo.head.commit.message
    d.close()


def test_remove_deletes_file_indexes_and_commits(vault: Path) -> None:
    import git
    from pkm.markdowndb.db import MarkdownDB
    d = MarkdownDB(vault=vault, embed_model=None, watch=False, commit_model="openrouter/free")
    d.load()
    with patch("pkm.markdowndb.vault_git._ai_commit_message", return_value="delete note1.md"):
        d.remove("note1.md")
    assert d.get("note1.md") is None
    assert not (vault / "note1.md").exists()
    d.close()
```

- [ ] **Step 2: Run to verify failure**

```bash
uv run pytest tests/pkm/markdowndb/test_vault_git.py::test_write_creates_file_indexes_and_commits -v
```

Expected: `AttributeError: 'MarkdownDB' object has no attribute 'write'`

- [ ] **Step 3: Add write/remove to db.py**

In `MarkdownDB.__init__`, add:

```python
from pkm.markdowndb.vault_git import VaultGit, find_vault_root
self._git = VaultGit(vault=self._vault, commit_model=commit_model)
```

Add methods:

```python
def write(self, path: str, text: str) -> None:
    """MCP mutator: write file to disk, reindex, auto-commit."""
    md_file = self._vault / path
    md_file.parent.mkdir(parents=True, exist_ok=True)
    md_file.write_text(text, encoding="utf-8")
    self.upsert(path)
    self._git.commit_paths([path], action="add" if not md_file.exists() else "update")

def remove(self, path: str) -> None:
    """MCP mutator: delete file from disk, reindex, auto-commit."""
    md_file = self._vault / path
    if md_file.exists():
        md_file.unlink()
    self.delete(path)
    self._git.commit_paths([path], action="delete")
```

Fix `write`: the `exists()` check is before the write. Correct version:

```python
def write(self, path: str, text: str) -> None:
    """MCP mutator: write file to disk, reindex, auto-commit."""
    md_file = self._vault / path
    md_file.parent.mkdir(parents=True, exist_ok=True)
    action = "update" if md_file.exists() else "add"
    md_file.write_text(text, encoding="utf-8")
    self.upsert(path)
    self._git.commit_paths([path], action=action)
```

- [ ] **Step 4: Run tests**

```bash
uv run pytest tests/pkm/markdowndb/test_vault_git.py -v
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pkm/markdowndb/db.py tests/pkm/markdowndb/test_vault_git.py
git commit -m "feat: add write/remove MCP mutators with auto-commit"
```

---

## Task 13: OTEL instrumentation

**Files:**
- Modify: `src/pkm/markdowndb/db.py`
- Modify: `src/pkm/markdowndb/vault_git.py`

- [ ] **Step 1: Write smoke test**

Add to `tests/pkm/markdowndb/test_db.py`:

```python
def test_otel_no_crash_with_noop_provider(db: MarkdownDB) -> None:
    # OTEL no-op provider is default — spans should emit without error
    hits = db.search_text("hello", limit=5)
    assert isinstance(hits, list)
```

(This test already passes since no-op is default — just ensures we don't crash when adding instrumentation.)

- [ ] **Step 2: Add OTEL to db.py**

At top of `db.py`:

```python
from opentelemetry import trace, metrics

_tracer = trace.get_tracer("markdowndb")
_meter = metrics.get_meter("markdowndb")
_notes_gauge = _meter.create_gauge("markdowndb.notes.indexed")
_search_latency = _meter.create_histogram("markdowndb.search.latency")
_upsert_counter = _meter.create_counter("markdowndb.upsert.count")
_embed_hits = _meter.create_counter("markdowndb.embed.cache.hits")
_embed_misses = _meter.create_counter("markdowndb.embed.cache.misses")
```

Wrap `load()`:

```python
def load(self) -> None:
    with _tracer.start_as_current_span("markdowndb.load") as span:
        self._conn.execute("DELETE FROM notes")
        count = 0
        for md_file in sorted(self._vault.rglob("*.md")):
            rel = str(md_file.relative_to(self._vault))
            text = md_file.read_text(encoding="utf-8")
            with _tracer.start_as_current_span("markdowndb.parse") as pspan:
                pspan.set_attribute("path", rel)
                note = parse_note(rel, text, md_file.stat().st_mtime)
            self._insert_note(note)
            count += 1
        self._conn.execute("INSTALL fts; LOAD fts;")
        self._rebuild_fts()
        cache_hits, cache_misses = self._load_embeddings_instrumented()
        if self._watch:
            self._start_watcher()
        span.set_attribute("note_count", count)
        span.set_attribute("cache_hits", cache_hits)
        span.set_attribute("cache_misses", cache_misses)
        _notes_gauge.set(count)
```

Replace `_load_embeddings` with `_load_embeddings_instrumented() -> tuple[int, int]` returning hit/miss counts, calling `_embed_hits.add(...)` and `_embed_misses.add(...)`.

Wrap `search_text`, `search_semantic`, `search` with `_tracer.start_as_current_span("markdowndb.search")` and set `mode`, `query_len`, `result_count` attributes.

Wrap `upsert` with `_tracer.start_as_current_span("markdowndb.upsert")` and set `path`, `file_changed` attributes. Call `_upsert_counter.add(1)`.

Wrap `VaultGit.commit_paths` with `_tracer.start_as_current_span("markdowndb.commit")` and set `path`, `fallback_used` attributes.

- [ ] **Step 3: Run all tests**

```bash
uv run pytest tests/pkm/markdowndb/ -v --ignore=tests/pkm/markdowndb/test_watcher.py -m "not slow"
```

Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add src/pkm/markdowndb/db.py src/pkm/markdowndb/vault_git.py
git commit -m "feat: add OTEL spans and metrics (no-op by default)"
```

---

## Task 14: Config (pkm layer)

**Files:**
- Create: `src/pkm/config.py`
- Create: `tests/pkm/test_config.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/pkm/test_config.py
import pytest
import os
from pathlib import Path
from pkm.config import load_settings, PkmSettings


def test_defaults(vault: Path) -> None:
    settings = load_settings(vault)
    assert settings.embed_model == "BAAI/bge-small-en-v1.5"
    assert settings.watch is True
    assert settings.search_limit == 10
    assert settings.commit_model == "openrouter/free"


def test_yaml_overrides(vault: Path) -> None:
    (vault / "pkm.yaml").write_text("search_limit: 25\nwatch: false\n")
    settings = load_settings(vault)
    assert settings.search_limit == 25
    assert settings.watch is False


def test_env_overrides_yaml(vault: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    (vault / "pkm.yaml").write_text("search_limit: 25\n")
    monkeypatch.setenv("PKM_SEARCH_LIMIT", "99")
    settings = load_settings(vault)
    assert settings.search_limit == 99


def test_no_git_repo_raises(tmp_path: Path) -> None:
    from pkm.markdowndb.vault_git import find_vault_root
    with pytest.raises(RuntimeError, match="git repo"):
        find_vault_root(tmp_path)


def test_load_settings_needs_test_vault_fixture(vault: Path) -> None:
    # vault fixture is imported from conftest
    settings = load_settings(vault)
    assert isinstance(settings, PkmSettings)
```

Note: the `vault` fixture lives in `tests/pkm/markdowndb/conftest.py`. Move it to `tests/pkm/conftest.py` so `tests/pkm/test_config.py` can use it:

- [ ] **Step 2: Move conftest**

Move `vault` fixture to `tests/pkm/conftest.py` and remove it from `tests/pkm/markdowndb/conftest.py` (keep `db` fixture there, importing `vault` from parent).

```python
# tests/pkm/conftest.py
import pytest
import git
from pathlib import Path


@pytest.fixture
def vault(tmp_path: Path) -> Path:
    (tmp_path / "note1.md").write_text(
        "---\nid: n1\ntags: [todo]\n---\nHello world"
    )
    (tmp_path / "note2.md").write_text(
        "---\nid: n2\ntags: [project]\n---\nCollectors fallacy in note taking"
    )
    sub = tmp_path / "sub"
    sub.mkdir()
    (sub / "note3.md").write_text(
        "---\ntags: [project]\n---\nSee [note1](../note1.md)"
    )
    repo = git.Repo.init(tmp_path)
    repo.config_writer().set_value("user", "name", "Test").release()
    repo.config_writer().set_value("user", "email", "test@test.com").release()
    repo.index.add(["note1.md", "note2.md", "sub/note3.md"])
    repo.index.commit("initial")
    return tmp_path
```

```python
# tests/pkm/markdowndb/conftest.py
import pytest
from pathlib import Path
from pkm.markdowndb.db import MarkdownDB


@pytest.fixture
def db(vault: Path) -> MarkdownDB:
    d = MarkdownDB(vault=vault, embed_model=None, watch=False)
    d.load()
    return d
```

- [ ] **Step 3: Run to verify failure**

```bash
uv run pytest tests/pkm/test_config.py -v
```

Expected: `ModuleNotFoundError: No module named 'pkm.config'`

- [ ] **Step 4: Implement config.py**

```python
# src/pkm/config.py
from pathlib import Path
from pydantic import Field
from pydantic_settings import BaseSettings, PydanticBaseSettingsSource, SettingsConfigDict, YamlConfigSettingsSource
from pkm.markdowndb.vault_git import find_vault_root


class PkmSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="PKM_", extra="forbid")

    embed_model: str = "BAAI/bge-small-en-v1.5"
    watch: bool = True
    cache_dir: Path = Path(".markdowndb")
    search_limit: int = 10
    commit_model: str = "openrouter/free"


def load_settings(start: Path = Path.cwd()) -> PkmSettings:
    """Load PkmSettings from pkm.yaml at vault root, overridable by PKM_* env."""
    vault_root = find_vault_root(start)
    yaml_file = vault_root / "pkm.yaml"

    class _S(PkmSettings):
        @classmethod
        def settings_customise_sources(
            cls,
            settings_cls: type[BaseSettings],
            init_settings: PydanticBaseSettingsSource,
            env_settings: PydanticBaseSettingsSource,
            dotenv_settings: PydanticBaseSettingsSource,
            file_secret_settings: PydanticBaseSettingsSource,
        ) -> tuple[PydanticBaseSettingsSource, ...]:
            return (init_settings, env_settings, YamlConfigSettingsSource(settings_cls, yaml_file=yaml_file))

    return _S()
```

- [ ] **Step 5: Run tests**

```bash
uv run pytest tests/pkm/test_config.py -v
```

Expected: all 5 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pkm/config.py tests/pkm/conftest.py tests/pkm/markdowndb/conftest.py tests/pkm/test_config.py
git commit -m "feat: add PkmSettings config (pydantic-settings + pkm.yaml, env override)"
```

---

## Task 15: OTEL SDK wiring in MCP server

**Files:**
- Modify: `src/pkm/mcp/server.py`

- [ ] **Step 1: Add OTEL SDK bootstrap**

Prepend to `server.py` before `FastMCP` instantiation:

```python
import os
import logging
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter
from opentelemetry.sdk.resources import Resource

def _setup_otel() -> None:
    resource = Resource({"service.name": os.environ.get("OTEL_SERVICE_NAME", "pkm-mcp")})
    provider = TracerProvider(resource=resource)
    endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT")
    if endpoint:
        from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
        provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=endpoint)))
    else:
        provider.add_span_processor(BatchSpanProcessor(ConsoleSpanExporter()))
    trace.set_tracer_provider(provider)
    logging.getLogger().addHandler(logging.StreamHandler())

_setup_otel()
```

- [ ] **Step 2: Verify no crash**

```bash
uv run python -c "from pkm.mcp.server import mcp; print(mcp.name)"
```

Expected: `pkm` (no error).

- [ ] **Step 3: Commit**

```bash
git add src/pkm/mcp/server.py
git commit -m "feat: wire OTEL SDK in MCP server (env-driven OTLP, console fallback)"
```

---

## Task 16: MCP tools

**Files:**
- Modify: `src/pkm/mcp/server.py`

These are thin wrappers over `MarkdownDB`. The DB is loaded once at module level using `load_settings()`.

- [ ] **Step 1: Add tools to server.py**

```python
# src/pkm/mcp/server.py  (additions after _setup_otel())
from pathlib import Path
from pkm.config import load_settings
from pkm.markdowndb.db import MarkdownDB

_settings = load_settings()
_vault = Path(_settings.cache_dir).parent.parent  # vault = git root
_db = MarkdownDB(
    vault=_vault,
    embed_model=_settings.embed_model,
    watch=_settings.watch,
    cache_dir=_vault / _settings.cache_dir,
    commit_model=_settings.commit_model,
)
_db.load()
```

Wait — `load_settings()` calls `find_vault_root(Path.cwd())`. The `vault` is the git root, not derived from `cache_dir`. Correct wiring:

```python
from pathlib import Path
from pkm.config import load_settings
from pkm.markdowndb.vault_git import find_vault_root
from pkm.markdowndb.db import MarkdownDB

_settings = load_settings()
_vault = find_vault_root(Path.cwd())
_db = MarkdownDB(
    vault=_vault,
    embed_model=_settings.embed_model,
    watch=_settings.watch,
    cache_dir=_vault / _settings.cache_dir,
    commit_model=_settings.commit_model,
)
_db.load()


@mcp.tool
def get_note(path: str) -> dict[str, object] | None:
    note = _db.get(path)
    if note is None:
        return None
    return note.model_dump()


@mcp.tool
def search_notes(query: str, limit: int | None = None) -> list[dict[str, object]]:
    hits = _db.search(query, limit=limit or _settings.search_limit)
    return [h.model_dump() for h in hits]


@mcp.tool
def write_note(path: str, text: str) -> dict[str, object]:
    _db.write(path, text)
    note = _db.get(path)
    assert note is not None
    return note.model_dump()


@mcp.tool
def remove_note(path: str) -> bool:
    _db.remove(path)
    return True


@mcp.tool
def validate_vault(paths: list[str] | None = None) -> dict[str, object]:
    report = _db.validate(paths)
    return report.model_dump()
```

- [ ] **Step 2: Verify tools register**

```bash
uv run python -c "
from pkm.mcp.server import mcp
tools = mcp.list_tools()
import asyncio
result = asyncio.run(tools)
print([t.name for t in result])
"
```

Expected output includes: `ping`, `get_note`, `search_notes`, `write_note`, `remove_note`, `validate_vault`

- [ ] **Step 3: Commit**

```bash
git add src/pkm/mcp/server.py
git commit -m "feat: add MCP tools (get_note, search_notes, write_note, remove_note, validate_vault)"
```

---

## Task 17: prek hook + __init__ exports

**Files:**
- Modify: `src/pkm/markdowndb/__init__.py`
- Note: the vault's `.pre-commit-config.yaml` lives in the vault repo, not this one

- [ ] **Step 1: Export public API**

```python
# src/pkm/markdowndb/__init__.py
from pkm.markdowndb.db import MarkdownDB
from pkm.markdowndb.models import (
    Frontmatter,
    MarkdownParseError,
    Note,
    SearchHit,
    ValidationReport,
    Violation,
)
from pkm.markdowndb.vault_git import find_vault_root

__all__ = [
    "MarkdownDB",
    "Frontmatter",
    "MarkdownParseError",
    "Note",
    "SearchHit",
    "ValidationReport",
    "Violation",
    "find_vault_root",
]
```

- [ ] **Step 2: Run full test suite**

```bash
uv run pytest tests/ -v -m "not slow"
```

Expected: all pass.

- [ ] **Step 3: Run prek**

```bash
prek run --all-files
```

Expected: ruff-check, ruff-format, basedpyright all PASS.

- [ ] **Step 4: Final commit**

```bash
git add src/pkm/markdowndb/__init__.py
git commit -m "feat: export markdowndb public API"
```

---

## Self-review notes

- **Spec §Git:** `VaultGit` is constructed in `MarkdownDB.__init__` — always-on, no flag. ✓
- **Spec §Validation runtime:** `load()` raises `MarkdownParseError` (via `parse_note`). ✓
- **Spec §Validation pre-commit:** `db.validate()` collects without raising; `markdowndb lint` CLI exits non-zero. ✓
- **Spec §Cache:** `EmbeddingCache` keyed by `body_hash`+`model`; model mismatch → cache miss → re-embed. ✓
- **Spec §Watcher dedupe:** `upsert` no-ops when `file_hash` unchanged. ✓
- **Spec §OTEL:** `markdowndb.parse` is a leaf span inside `markdowndb.load`; `markdowndb.validate` is a parent span over validate passes. Note: validate span wiring not shown — add `_tracer.start_as_current_span("markdowndb.validate")` wrapper in `db.validate()` method.
- **Gap:** `markdowndb.validate` OTEL span not explicitly coded in Task 13. Add to `db.validate()` in Task 13:

```python
def validate(self, paths: list[str] | None = None) -> ValidationReport:
    with _tracer.start_as_current_span("markdowndb.validate") as span:
        # ... existing body ...
        span.set_attribute("file_count", len(candidates))
        span.set_attribute("violation_count", len(violations))
        return ValidationReport(violations=violations)
```

- **Type consistency:** `_row_to_note` receives `row[:9]` in search — verify column ordering matches DDL (path, file_hash, body_hash, mtime, id, tags, aliases, extra, body = 9 cols). ✓
- **`write` method:** checks `md_file.exists()` before writing for `action` — correct. ✓
