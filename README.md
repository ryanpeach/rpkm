# Personal PKM

I have my own personal requirements for a PKM.

## Fully [commonmark](https://commonmark.org/) with [yaml frontmatter](https://docs.github.com/en/contributing/writing-for-github-docs/using-yaml-frontmatter)

All these different markdowns really makes parsing (for scripting) and compatibility a pain. We are not going to go away from commonmark. We will add a feature to the yaml frontmatter if its missing.

## The [Collector's Fallacy](https://zettelkasten.de/posts/collectors-fallacy/)

Note taking isn't for collecting. It's for retrieval, and, better yet, memorization. You shouldn't take very long formatting your notes to link to other notes either. I actually think it's important to limit the amount of "work" it takes to maintain the PKM.

## Git Versioning

PKM's need versioning too. You especially can't have an AI crawling around your stuff without it being reviewed and versioned.

# Todos

Todo's can be handled as one-md-file-per-todo in folders-as-projects with several standard frontmatter:

```yaml
status: enum  # Done, Wont-Do, In-Progress, Next, Backlog, etc
deadline: datetime  # When you have to do it by
planned_on: datetime  # When you plan to do it
tags: list[str]  # encompases priority as well as things like location, urgency, etc.
```

# Habits & Recurring Todos

Habits are really just recurring todos. They go in projects. You add times you did them to the yaml frontmatter as a list item under `completions`

```yaml
completions:
  - status: Done
    completed_on: datetime
    duration: 30m  # How long did you do it for in the case of things like workouts
```

recurring can be like

```yaml
schedule:
    frequency: weekly
    skip: 0  # 1 would mean skip one week
```

or

```yaml
schedule:
    frequency: weekly
    times: 3  # How many times per week?
```

# TODO Memorizing

Should write memorizables into [mdanki](https://github.com/ashlinchak/mdanki) compatible formatting.

Flashcards related to a markdown file `foobar.md` should be stored in `foobar.flashcards.md`. The `foobar.md` gets a frontmatter item `flashcard_link` and the flashcard file gets a frontmatter item `original_link`. Still, these files should always stay named the same.

# TODO Journaling

Journaling can be in its own folder in commonmark.

# TODO Tracking

## Tracking Numerics

# TODO Hoarding

Hoarding should be considered different from found knowledge.

## Hoarding Websites

A folder of HTML should do nicely.

## Hoarding PDF's and their Annotations

Use standard PDF features. Nothing fancy.

# TODO Retrieval

# TODO Migration

Because we use commonmark and yaml frontmatter, migration of the data should be easy in any scripting language.

## TODO Folder Schemas

A folder can contain a `.schema` file to specify a schema for all the files within the folder.

markdowndb can validate this schema for all files.

AI + DuckDB can perform migrations after validation.

# UI

No need for a custom UI. Because we use commonmark, use VSCode or something.

We also primarily want the user to be able to interact with everything via voice over an AI via an MCP. I'm a big fan of voice notes.

# TODO Uploads

For all uploads:

1. The raw file goes in `./assets` folder
2. An `.md` file goes in `.` and has the same name as the raw file.
3. The path of the asset goes in the frontmatter as `original_link` (not as a markdown link, markdown links are not supported in frontmatter)
4. The body of the `.md` file contains a header `# AI Generated` and then that becomes info about the original

## Images

1. The header `# AI Generated`.`## Description` contains an AI description of the image.
2. The header `# AI Generated`.`## OCR` contains any text OCR'd from the image.

## Voice Notes

1. The header `# AI Generated`.`## Summary` contains an AI summary of the voice note.
2. The header `# AI Generated`.`## Transcript` contains a transcript of the voice note.

# Validation Loop

<!-- If validation does not pass, and the git tree is not dirty, someone made a mistake, whether it was the user or AI. markdownmd uses gitpython to make a commit to the branch (with AI generated commit message). Then agentic ai fixes the validation. Then it makes a PR. Then it switches back to a branch it can work in (without validation errors). AI never makes changes without a PR. -->

If the user is actively working in a file, the git repo will be dirty. The MCP will pause activity until the user commits changes. Pre commit will prevent the user from committing invalid changes.