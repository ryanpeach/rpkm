import { init } from "./init.ts";
import { LintError, RepoDirtyError } from "./utils/errors.ts";
import { isRepoDirty } from "./utils/git.ts";
import { prekRunListFiles, prekRunAllFiles } from "./utils/prek.ts";

export async function lint_everything(projectPath: string): Promise<LintError[]> {
    await init(projectPath)   // Linting includes that everything has been init'ed properly
    const out: LintError[] = []
    if (await isRepoDirty(projectPath)) {
        out.push(new RepoDirtyError("Repo is Dirty"))
    }
    const prekError = await prekRunAllFiles(projectPath);
    if (prekError) {
        out.push(prekError)
    }
    return out
}

export async function lint_list_files(projectPath: string, paths: string[]): Promise<LintError[]> {
    await init(projectPath)  // Linting includes that everything has been init'ed properly
    const out: LintError[] = []
    const prekError = await prekRunListFiles(projectPath, paths);
    if (prekError) {
        out.push(prekError)
    }
    return out
}
