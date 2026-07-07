import { CommitResult, Options, Response, simpleGit } from "simple-git";
import { exists } from "@std/fs/exists";


export async function findProjectRoot(cwd = Deno.cwd()): Promise<string> {
  return await simpleGit(cwd).revparse(["--show-toplevel"]).then((s) => s.trim());
}

export async function isRepoDirty(projectPath: string): Promise<boolean> {
   const status = await simpleGit(projectPath).status();
   return status.files.length > 0;
}

/**
 * If this is not a git repo, init one.
 * @param projectPath The project projectPath
 */
export async function ensureGitRepo(projectPath: string): Promise<void> {
    if (!await simpleGit(projectPath).checkIsRepo()) {
        await simpleGit(projectPath).init()
    }
}

/**
 * If gitignore does not exist, create it with the ignore string.
 * If gitignore does not ignore the ignore string, append it
 * @param projectPath The project projectPath
 * @param ignore The string to check for or add to the gitignore
 */
export async function ensureGitIgnore(projectPath: string, ignore: string): Promise<void> {
    const gitignore = `${projectPath}/.gitignore`;
    if (!await exists(gitignore)) {
        await Deno.writeTextFile(gitignore, ignore);
        await simpleGit(projectPath).add(".gitignore").commit(`Auto: Created .gitignore with ${ignore}`, { arguments: ["--no-verify"] });
    } else {
        const content = await Deno.readTextFile(gitignore).catch(() => "");
        if (!content.split("\n").includes(ignore)) {
            await Deno.writeTextFile(gitignore, `\n${ignore}`, {append: true });
            await simpleGit(projectPath).add(".gitignore").commit(`Auto: Added ${ignore} to .gitignore`)
        }
    }
}

