import { ensureGitRepo, ensureGitIgnore } from "./utils/git.ts";
import { ensureLycheePrek, ensureMdLinkerPrek, ensureTyposPrek, prekUpdate } from "./utils/prek.ts";

export async function init(projectPath: string): Promise<void> {
    await ensureGitRepo(projectPath)
    await ensureGitIgnore(projectPath, ".markdowndb")
    await ensureGitIgnore(projectPath, "*.db")
    await ensureLycheePrek(projectPath)
    await ensureMdLinkerPrek(projectPath)
    await ensureTyposPrek(projectPath)
    await prekUpdate(projectPath)
}