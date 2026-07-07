import { exists } from "@std/fs/exists";
import { join } from "@std/path/join";
import { LintError } from "./errors.ts";
import { parse, stringify } from "jsr:@std/toml";
import { ensureGitIgnore } from "./git.ts";
import { rangeIntersects } from "jsr:@std/semver@^1.0.8/range-intersects";
import { simpleGit } from "simple-git";

/**
 * Makes sure the prek file exists.
 * @param projectPath The path the prek file lives in
 * @returns void
 */
async function ensurePrek(projectPath: string): Promise<void> {
    if (await exists(join(projectPath, ".pre-commit-config.yaml")) || await exists(join(projectPath, ".pre-commit-config.yml"))) {
        // Convert pre-comit-config to prek toml
        await new Deno.Command("prek", {args: ["util", "yaml-to-toml"]}).output();
        await simpleGit(projectPath).add("prek.toml").commit("Auto: Converted pre-commit config to prek.toml", { arguments: ["--no-verify"] });

    } else if (await exists(join(projectPath, "prek.toml"))) {
        return
    } else {
        // Create the prek file
        await Deno.writeTextFile(join(projectPath, "prek.toml"), "");
        await simpleGit(projectPath).add("prek.toml").commit("Auto: Created prek.toml", { arguments: ["--no-verify"] });
    }
}

async function readPrekToml(projectPath: string): Promise<Record<string, unknown>> {
    return parse(await Deno.readTextFile(join(projectPath, 'prek.toml')));
}

/**
 * Rewrites the toml file completely with new updates
 * @todo Make the minimal write to prek.toml for the difference
 *       in the incoming object and the existing prek toml.
 * @param projectPath The path the prek file lives in.
 * @param prek The new prek toml to write.
 */
async function writePrekToml(projectPath: string, prek: object): Promise<void> {
    await Deno.writeTextFile(join(projectPath, "prek.toml"), stringify(prek as Record<string, unknown>));
    await simpleGit(projectPath).add("prek.toml").commit("Auto: Updated prek.toml", { arguments: ["--no-verify"] });
}

function hasRepo(prek: Record<string, unknown>, repoUrl: string): boolean {
    return Array.isArray(prek.repos) &&
        (prek.repos as Array<Record<string, unknown>>).some(r => r.repo === repoUrl);
}

/**
 * No broken links means that all existing links are healthy.
 * @param projectPath The path the prek file lives in.
 */
export async function ensureLycheePrek(projectPath: string) {
    await ensureGitIgnore(projectPath, ".lycheecache")
    const prek = await readPrekToml(projectPath);
    if (!hasRepo(prek, "https://github.com/lycheeverse/lychee.git")) {
        if (!Array.isArray(prek.repos)) prek.repos = [];
        (prek.repos as unknown[]).push({
            repo: "https://github.com/lycheeverse/lychee.git",
            rev: "v0.15.1",
            hooks: [{ id: "lychee", args: ["--no-progress"] }]
        });
    }
    await writePrekToml(projectPath, prek);
}
/**
 * No typos means potential links are less likely to be missed due to being mispelled.
 * @param projectPath The path the prek file lives in.
 */
export async function ensureTyposPrek(projectPath: string) {
    const prek = await readPrekToml(projectPath);
    if (!hasRepo(prek, "https://github.com/crate-ci/typos")) {
        if (!Array.isArray(prek.repos)) prek.repos = [];
        (prek.repos as unknown[]).push({
            repo: "https://github.com/crate-ci/typos",
            rev: "v1.23.7",
            hooks: [{ id: "typos" }]
        });
    }
    await writePrekToml(projectPath, prek);
}

/**
 * MdLinker will help you find links you missed, help you find aliases that should be disambiguated, and much more.
 * @param projectPath The path the prek file lives in.
 */
export async function ensureMdLinkerPrek(projectPath: string): Promise<void> {
    const prek = await readPrekToml(projectPath);
    if (!hasRepo(prek, "https://github.com/ryanpeach/mdlinker")) {
        if (!Array.isArray(prek.repos)) prek.repos = [];
        (prek.repos as unknown[]).push({
            repo: "https://github.com/ryanpeach/mdlinker",
            rev: "v1.7.2",
            hooks: [{ id: "enforce-ascii" }, { id: "mdlinker" }]
        });
    }
    await writePrekToml(projectPath, prek);
}

export class PrekError extends LintError {}

export async function prekRunAllFiles(projectPath: string, retry = 2): Promise<PrekError | void> {
    let output = null;
    for (let i = 0; i < retry; i++) {
        output = await new Deno.Command("prek", {args: ["run", "--cd", projectPath]}).output();
        await simpleGit(projectPath).add(".").commit("Auto: ran prek on all", {arguments: ["--no-verify"]}).catch(() => {});
        if (output.success) return;
    }
    return new PrekError(new TextDecoder().decode(output?.stderr));
}

export async function prekRunListFiles(projectPath: string, paths: string[], retry = 2): Promise<PrekError | void> {
    let output = null;
    for (let i = 0; i < retry; i++) {
        output = await new Deno.Command("prek", {args: ["run", "--cd", projectPath, "--files", ...paths]}).output();
        await simpleGit(projectPath).add(paths).commit(`Auto: ran prek on ${paths}`, {arguments: ["--no-verify"]}).catch(() => {});
        if (output.success) return;
    }
    return new PrekError(new TextDecoder().decode(output?.stderr));
}

export async function prekUpdate(projectPath: string): Promise<PrekError | void> {
    const output = await new Deno.Command("prek", {args: ["update", "--cd", projectPath]}).output();
    if (!output.success) return new PrekError(new TextDecoder().decode(output.stderr));
    await simpleGit(projectPath).add("prek.toml").commit("Auto: Updated prek", {arguments: ["--no-verify"]});
}