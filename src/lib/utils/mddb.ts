import { MarkdownDB } from "mddb";
import { join } from "@std/path";
import { exists } from "@std/fs/exists";

/**
 * Creates or reads {@link .markdowndb/markdown.db} and returns the MarkdownDB.
 * @param projectPath Project projectPath
 * @returns Markdowndb
 */
export async function load_mddb(projectPath: string): Promise<MarkdownDB> {
    const markdowndbPath = join(projectPath, ".markdowndb");
    if (!exists(markdowndbPath)) {await Deno.mkdir(markdowndbPath)}
    const dbPath = join(markdowndbPath, "markdown.db")

    const client = new MarkdownDB({
        client: "sqlite3",
        connection: {
            filename: dbPath,
        },
    });

    return await client.init();
}