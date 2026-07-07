import { simpleGit } from "simple-git";
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
 * If gitignore does not exist, create it.
 * If gitignore does not ignore .markdowndb and *.db, append them
 * @param projectPath The project projectPath
 */
export async function ensureMarkdowndbIgnored(projectPath: string): Promise<void> {
    const gitignore = `${projectPath}/.gitignore`;
    if (!exists(gitignore)) {Deno.writeTextFile(gitignore, ".markdowndb\n*.db")}
    else {
        const content = await Deno.readTextFile(gitignore).catch(() => "");
        if (!content.split("\n").includes(".markdowndb")) {
            await Deno.writeTextFile(gitignore, "\n.markdowndb", {append: true });
        }
        if (!content.split("\n").includes("*.db")) {
            await Deno.writeTextFile(gitignore, "\n*.db", {append: true });
        }
    }
}
