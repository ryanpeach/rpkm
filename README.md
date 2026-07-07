# Personal PKM

I have my own personal requirements for a PKM.

## Fully [Github Flavored Markdown](https://github.github.com/gfm/) with [yaml frontmatter](https://docs.github.com/en/contributing/writing-for-github-docs/using-yaml-frontmatter)

This is a common standard and it renders well in almost all major text editors and viewers, most importantly in github where you will commonly view markdown files whether publicly or privately. Yaml frontmatter extending this gives us a full database-like object for each markdown file.

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

## Habits & Recurring Todos & Tracking

Habits are really just recurring todos, and tracking is really just a habit with a numeric frontmatter you can query and aggregate. They go in projects but they get their own subfolder named the same as the todo. Then there is a root level file the same name as the folder with the recurring info and notes about the habit.

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

Then a new file is created per instance of completing the habit, called `YYYYMMDD.md`, with frontmatter containing details about tracked metrics, etc.

## Keeping Todo folders clean

Todo folders should contain an `Archive` folder and `Done` or `Wont Do` status notes should be moved into there.

# Retrieval

Retrieval is the **most important part** of note taking. What you can't retrieve is useless.

- [ ] Full Text Search
- [ ] Vector Search
- [ ] Graph RAG

# Memorizing

Memorizing is the second most important part of note taking. Understanding and facts are best synthesized in your mind.

- [ ] Store flashcards for `foobar.md` in `foobar.flashcards.tsv`
- [ ] Add a [footnote](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#footnotes) in `foobar.md` linking to its flashcards file
- [ ] Keep flashcard filenames stable (always match the source file name)

# TODO Journaling

Journals are different from structured notes. They are more train of thought and less organized. We can seperate them during graphrag and let them be longer.

- [ ] Create a dedicated journaling folder to keep structured notes seperate from train-of-thought notes
- [ ] Journals can violate the shortness validation

# TODO Hoarding

I define hoarding as distinct from compiled structured knowledge

## Hoarding Websites

- [ ] Store hoarded websites as HTML files in a dedicated folder with a pandoc converted md file same name with a footnote link both to the original and to the html

## Hoarding PDF's and their Annotations

- [ ] Use standard PDF annotation features (no custom tooling)

# Migration

Migration can be done using any scripting language due to the fact we are using github markdown + yaml frontmatter (very portable)

- [ ] A claude code skill should be able to do this better than an mcp

# UI

No need for a custom UI. Because we use markdown, use VSCode or something.

We also primarily want the user to be able to interact with everything via voice over an AI via an MCP. I'm a big fan of voice notes.

# TODO Uploads

For all uploads:

- [ ] The raw file goes in `./assets` folder
- [ ] An `.md` file goes in `.` and has the same name as the raw file.
- [ ] The path of the asset goes in the [footnotes](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#footnotes)
- [ ] The body of the `.md` file contains a header `# AI Generated` and then that becomes info about the original

## Images

- [ ] An MCP tool allows uploading images
    - [ ] The header `# AI Generated`.`## Description` contains an AI description of the image.
    - [ ] The header `# AI Generated`.`## OCR` contains any text OCR'd from the image.

## Voice Notes

- [ ] An MCP tool allows uploading voice notes
    - [ ] The header `# AI Generated`.`## Summary` contains an AI summary of the voice note.
    - [ ] The header `# AI Generated`.`## Transcript` contains a transcript of the voice note.

# Block Properties

The one modification we are going to make to github flavored markdown is the introduction of [block properties from logseq](https://discuss.logseq.com/t/lesson-5-how-to-power-your-workflows-using-properties-and-dynamic-variables/10173). This way we can add properties to todos and footnotes.

- [ ] Capture block properties

## Justification of Change

You can still parse the markdown with a standard markdown parser.

You can capture properties with simple regex such as `[\w-]+::\s+[\w-]+`

## Todos

By adding block properties to todos we can add things like `deadline::` `planned::` etc.

## Footnotes

By adding block properties to footnotes we can functionally turn our database into a [labeled property graph](https://en.wikipedia.org/wiki/Property_graph) greatly increasing our ability to perform graphrag.

- [ ] Turn footnotes into labeled property graph

# Validation

- [ ] If validation fails on a clean tree, auto-commit with AI-generated message
- [ ] Agentic AI fixes validation errors
- [ ] AI opens a PR for validation fixes (AI never commits directly without a PR)
- [ ] AI switches back to a clean working branch after PR
- [ ] MCP pauses activity when repo is dirty (user is actively editing)
- [x] Pre-commit hook blocks invalid commits

## Filenames

- [ ] Filenames stay lowercase with spaces.

We use spaces because the filename is also the default alias and some aliases have spaces. We use lowercase because its easy.

## AI Considerations

It's really important bodies are kept small for progressive disclosure

- [ ] Validate that documents are short

It's important to maintain links as best as possible.

- [x] Use lychee to make sure links are valid
- [x] mdlinker to find new links
- [x] spell checker to make sure words are discoverable by search

Maybe consider strict zettelkasten to stylistically accomodate more linking and shorter notes?

- [ ] parent/child/opposes/supports relationship:: block properties
