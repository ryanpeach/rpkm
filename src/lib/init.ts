import { ensureGitRepo, ensureMarkdowndbIgnored } from "./utils/git.ts";
import { ensureLycheePrek, ensureMdLinkerPrek } from "./utils/prek.ts";

export async function init(projectPath: string): Promise<void> {
    await ensureGitRepo(projectPath)
    await ensureMarkdowndbIgnored(projectPath)
    await ensureLycheePrek(projectPath)
    await ensureMdLinkerPrek(projectPath)
}