import { Command, EnumType } from "@cliffy/command";
import { findProjectRoot } from "../lib/utils/git.ts";
import { mcp } from "../lib/mcp.ts";
import { lint_everything, lint_list_files } from "../lib/lint.ts";
import { load_mddb } from "../lib/utils/mddb.ts";
import { init } from "../lib/init.ts";

const logLevelType = new EnumType(["debug", "info", "warn", "error"]);

await new Command()
    .name("pkm")
    .version("0.1.0")
    .description("A pkm cli")
    .type("log-level", logLevelType)
    .globalEnv("LOG_LEVEL=<level:log-level>", "Set your logging level (debug, info, warn, error).")
    .globalOption("-l, --log-level <level:log-level>", "Set your logging level (debug, info, warn, error).", {
        default: "info",
    })
    .globalEnv("PROJECT_PATH=<projectPath:string>", "Manually set the root path for your markdown files.")
    .globalOption("-p, --project-path <projectPath:string>", "Manually set the root path for your markdown files.", {
        default: await findProjectRoot(),
    })
    .command("lint", "Manually lint the given directory.")
    .option("-f, --files <filePaths:string[]>", "Lint individual files instead of everything.")
    .action((options) => {
        if (!options.files?.length) {
            lint_everything(options.projectPath);
        } else {
            lint_list_files(options.projectPath, options.files);
        }
    })
    .command("parse", "Manually scan a directory into markdowndb")
    .action((options) => {
        load_mddb(options.projectPath)
    })
    .command("mcp", "Run the mcp server.")
    .action((options) => {
        mcp(options.projectPath)
    })
    .command("init", "Checks your project for a few things before we begin.")
    .action((options) => {
        init(options.projectPath)
    })
    .parse();