# pkm — project conventions

## Typing

- Use strong, explicit typing everywhere. Annotate every function signature (params + return) and every dataclass/model field.
- No bare `Any`, no untyped `dict`/`list` — parameterize (`dict[str, int]`, `list[Note]`). If a type is genuinely dynamic, use `object` + narrowing, or a typed union, not `Any`.
- Code must pass `basedpyright` in strict mode with zero errors.

## Pydantic

- Model all structured data with `pydantic.BaseModel` (or `pydantic.dataclasses.dataclass`) — not plain dataclasses, `TypedDict`, or raw dicts — for anything crossing a boundary (config, API inputs/outputs, DB rows, parsed frontmatter).
- Prefer `model_validate` / `model_validate_json` for parsing external data over manual construction.
- Use field validators for coercion and constraints instead of hand-rolled checks.

## Tooling

- Lint + format: `ruff`.
- Type check: `basedpyright`.
- Git hooks run via `prek` (see `.pre-commit-config.yaml`).
- Package/deps: `uv`.
