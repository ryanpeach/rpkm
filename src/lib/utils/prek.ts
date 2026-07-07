import { exists } from "@std/fs/exists";
import { join } from "@std/path/join";
import { LintError } from "./errors.ts";

async function ensurePrek(projectPath: string) {
    if (exists(join(projectPath, ".pre-commit-config.yaml")) || exists(join(projectPath, ".pre-commit-config.yml"))) {
        // TODO: Run CLI conversion from pre-commit to prek
    } else if (exists(join(projectPath, "prek.toml"))) {
        return
    } else {
        // Create the prek file
        await Deno.writeTextFile(join(projectPath, "prek.toml"), "")
    }
}

async function readPrekToml(projectPath: string): Promise<object> {

}

export async function ensureLycheePrek(projectPath: string) {
    const prek = await readPrekToml(projectPath);
}
export async function ensureMdLinkerPrek(projectPath: string) {
    const prek = await readPrekToml(projectPath);
}

export class PrekError extends LintError {}

export async function prekRunAllFiles(projectPath: string): Promise<PrekError | void> {
    const output = await new Deno.Command("prek", {args: ["--cd", projectPath]}).output()
    if (!output.success) {
        return new PrekError(new TextDecoder().decode(output.stderr))
    }
}

export async function prekRunListFiles(projectPath: string, paths: string[]): Promise<PrekError | void> {
    const output = await new Deno.Command("prek", {args: ["--cd", projectPath, "--files", ...paths]}).output()
    if (!output.success) {
        return new PrekError(new TextDecoder().decode(output.stderr))
    }
}