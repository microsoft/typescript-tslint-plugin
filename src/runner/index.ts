import * as cp from 'child_process';
import * as minimatch from 'minimatch';
import { dirname, join, normalize, relative, sep } from 'path';
import type * as tslint from 'tslint';
import type { IConfigurationFile } from 'tslint/lib/configuration';
import type * as typescript from 'typescript';
import * as util from 'util';
import * as server from 'vscode-languageserver';
import { MruCache } from './mruCache';

export type PackageManager = 'npm' | 'pnpm' | 'yarn';

export function toPackageManager(manager: string | undefined): PackageManager | undefined {
    switch (manager && manager.toLowerCase()) {
        case 'npm': return 'npm';
        case 'pnpm': return 'pnpm';
        case 'yarn': return 'yarn';
        default: return undefined;
    }
}

export interface RunConfiguration {
    readonly jsEnable: boolean;
    readonly rulesDirectory?: string | string[];
    readonly configFile?: string;
    readonly ignoreDefinitionFiles: boolean;
    readonly exclude: string[];
    readonly validateWithDefaultConfig?: boolean;
    readonly packageManager?: PackageManager;
    readonly traceLevel?: 'verbose' | 'normal';
    readonly workspaceFolderPath?: string;

    /**
     * Controls where TSlint and other scripts can be loaded from.
     */
    readonly workspaceLibraryExecution: WorkspaceLibraryExecution;
}

/**
 * Controls where TSlint and other scripts can be loaded from.
 */
export enum WorkspaceLibraryExecution {
    /**
     * Block executing TSLint, linter rules, and other scripts from the current workspace.
     */
    Disallow = 1,
    /**
     * Enable loading TSLint and rules from the workspace.
     */
    Allow = 2,
    /**
     * The workspace library execution has not yet been configured or cannot be determined.
     */
    Unknown = 3,
}

interface Configuration {
    readonly linterConfiguration: tslint.Configuration.IConfigurationFile | undefined;
    isDefaultLinterConfig: boolean;
    readonly path?: string;
}

class ConfigCache {
    public configuration: Configuration | undefined;

    private filePath: string | undefined;

    constructor() {
        this.filePath = undefined;
        this.configuration = undefined;
    }

    public set(filePath: string, configuration: Configuration) {
        this.filePath = filePath;
        this.configuration = configuration;
    }

    public get(forPath: string): Configuration | undefined {
        return forPath === this.filePath ? this.configuration : undefined;
    }

    public isDefaultLinterConfig(): boolean {
        return !!(this.configuration && this.configuration.isDefaultLinterConfig);
    }

    public flush() {
        this.filePath = undefined;
        this.configuration = undefined;
    }
}

export interface RunResult {
    readonly lintResult: tslint.LintResult;
    readonly warnings: string[];
    readonly workspaceFolderPath?: string;
    readonly configFilePath?: string;
}

const emptyLintResult: tslint.LintResult = {
    errorCount: 0,
    warningCount: 0,
    failures: [],
    fixes: [],
    format: '',
    output: '',
};

const emptyResult: RunResult = {
    lintResult: emptyLintResult,
    warnings: [],
};

export class TsLintRunner {
    private readonly tslintPath2Library = new Map<string, { tslint: typeof tslint, path: string } | undefined>();

    private readonly document2LibraryCache = new MruCache<{
        readonly workspaceTslintPath: string | undefined,
        readonly globalTsLintPath: string | undefined,
        getTSLint(isTrusted: boolean): { tslint: typeof tslint, path: string } | undefined
    }>(100);

    // map stores undefined values to represent failed resolutions
    private readonly globalPackageManagerPath = new Map<PackageManager, string | undefined>();
    private readonly configCache = new ConfigCache();

    constructor(
        private readonly trace: (data: string) => void,
    ) { }

    public runTsLint(
        filePath: string,
        contents: string | typescript.Program,
        configuration: RunConfiguration,
    ): RunResult {
        this.traceMethod('runTsLint', 'start');

        const warnings: string[] = [];
        if (!this.document2LibraryCache.has(filePath)) {
            this.loadLibrary(filePath, configuration);
        }
        this.traceMethod('runTsLint', 'Loaded tslint library');

        if (!this.document2LibraryCache.has(filePath)) {
            return emptyResult;
        }

        const cacheEntry = this.document2LibraryCache.get(filePath)!;

        let library: { tslint: typeof tslint, path: string } | undefined;

        switch (configuration.workspaceLibraryExecution) {
            case WorkspaceLibraryExecution.Disallow:
                library = cacheEntry.getTSLint(false);
                break;

            case WorkspaceLibraryExecution.Allow:
                library = cacheEntry.getTSLint(true);
                break;

            default:
                if (cacheEntry.workspaceTslintPath) {
                    if (this.isWorkspaceImplicitlyTrusted(cacheEntry.workspaceTslintPath)) {
                        configuration = { ...configuration, workspaceLibraryExecution: WorkspaceLibraryExecution.Allow };
                        library = cacheEntry.getTSLint(true);
                        break;
                    }

                    // If the user has not explicitly trusted/not trusted the workspace AND we have a workspace TS version
                    // show a special error that lets the user trust/untrust the workspace
                    return {
                        lintResult: emptyLintResult,
                        warnings: [
                            getWorkspaceNotTrustedMessage(filePath),
                        ],
                    };
                } else if (cacheEntry.globalTsLintPath) {
                    library = cacheEntry.getTSLint(false);
                }
                break;
        }

        if (!library) {
            return {
                lintResult: emptyLintResult,
                warnings: [
                    getInstallFailureMessage(
                        filePath,
                        configuration.packageManager || 'npm'),
                ],
            };
        }

        this.traceMethod('runTsLint', 'About to validate ' + filePath);
        return this.doRun(filePath, contents, library, configuration, warnings);
    }

    public onConfigFileChange(_tsLintFilePath: string) {
        this.configCache.flush();
    }

    private traceMethod(method: string, message: string) {
        this.trace(`(${method}) ${message}`);
    }

    private loadLibrary(filePath: string, configuration: RunConfiguration): void {
        this.traceMethod('loadLibrary', `trying to load ${filePath}`);
        const directory = dirname(filePath);

        const tsLintPaths = this.getTsLintPaths(directory, configuration.packageManager);

        this.traceMethod('loadLibrary', `Resolved tslint to workspace: '${tsLintPaths.workspaceTsLintPath}' global: '${tsLintPaths.globalTsLintPath}'`);

        this.document2LibraryCache.set(filePath, {
            workspaceTslintPath: tsLintPaths.workspaceTsLintPath || undefined,
            globalTsLintPath: tsLintPaths.globalTsLintPath || undefined,
            getTSLint: (allowWorkspaceLibraryExecution: boolean) => {
                const tsLintPath = allowWorkspaceLibraryExecution
                    ? tsLintPaths.workspaceTsLintPath || tsLintPaths.globalTsLintPath
                    : tsLintPaths.globalTsLintPath;

                if (!tsLintPath) {
                    return;
                }

                let library;
                if (!this.tslintPath2Library.has(tsLintPath)) {
                    try {
                        library = require(tsLintPath);
                    } catch (e) {
                        this.tslintPath2Library.set(tsLintPath, undefined);
                        return;
                    }
                    this.tslintPath2Library.set(tsLintPath, { tslint: library, path: tsLintPath });
                }
                return this.tslintPath2Library.get(tsLintPath);
            }
        });
    }

    private getTsLintPaths(directory: string, packageManager: PackageManager | undefined) {
        const globalPath = this.getGlobalPackageManagerPath(packageManager);

        let workspaceTsLintPath: string | undefined;
        try {
            workspaceTsLintPath = this.resolveTsLint({ nodePath: undefined, cwd: directory }) || undefined;
        } catch {
            // noop
        }

        let globalTSLintPath: string | undefined;
        try {
            globalTSLintPath = this.resolveTsLint({ nodePath: undefined, cwd: globalPath });
        } catch {
            // noop
        }
        if (!globalTSLintPath) {
            globalTSLintPath = this.resolveTsLint({ nodePath: globalPath, cwd: globalPath });
        }
        return { workspaceTsLintPath, globalTsLintPath: globalTSLintPath };
    }

    private getGlobalPackageManagerPath(packageManager: PackageManager = 'npm'): string | undefined {
        this.traceMethod('getGlobalPackageManagerPath', `Begin - Resolve Global Package Manager Path for: ${packageManager}`);

        if (!this.globalPackageManagerPath.has(packageManager)) {
            let path: string | undefined;
            if (packageManager === 'npm') {
                path = server.Files.resolveGlobalNodePath(this.trace);
            } else if (packageManager === 'yarn') {
                path = server.Files.resolveGlobalYarnPath(this.trace);
            } else if (packageManager === 'pnpm') {
                path = cp.execSync('pnpm root -g').toString().trim();
            }
            this.globalPackageManagerPath.set(packageManager, path);
        }
        this.traceMethod('getGlobalPackageManagerPath', `Done - Resolve Global Package Manager Path for: ${packageManager}`);
        return this.globalPackageManagerPath.get(packageManager);
    }

    private doRun(
        filePath: string,
        contents: string | typescript.Program,
        library: { tslint: typeof tslint, path: string },
        configuration: RunConfiguration,
        warnings: string[],
    ): RunResult {
        this.traceMethod('doRun', `starting validation for ${filePath}`);

        let cwd = configuration.workspaceFolderPath;
        if (!cwd && typeof contents === "object") {
            cwd = contents.getCurrentDirectory();
        }

        if (this.fileIsExcluded(configuration, filePath, cwd)) {
            this.traceMethod('doRun', `No linting: file ${filePath} is excluded`);
            return emptyResult;
        }

        let cwdToRestore: string | undefined;
        if (cwd && configuration.workspaceLibraryExecution === WorkspaceLibraryExecution.Allow) {
            this.traceMethod('doRun', `Changed directory to ${cwd}`);
            cwdToRestore = process.cwd();
            process.chdir(cwd);
        }

        try {
            const configFile = configuration.configFile || null;
            let linterConfiguration: Configuration | undefined;
            this.traceMethod('doRun', 'About to getConfiguration');
            try {
                linterConfiguration = this.getConfiguration(filePath, filePath, library.tslint, configFile);
            } catch (err) {
                this.traceMethod('doRun', `No linting: exception when getting tslint configuration for ${filePath}, configFile= ${configFile}`);
                warnings.push(getConfigurationFailureMessage(err));
                return {
                    lintResult: emptyLintResult,
                    warnings,
                };
            }

            if (!linterConfiguration) {
                this.traceMethod('doRun', `No linting: no tslint configuration`);
                return emptyResult;
            }
            this.traceMethod('doRun', 'Configuration fetched');

            if (isJsDocument(filePath) && !configuration.jsEnable) {
                this.traceMethod('doRun', `No linting: a JS document, but js linting is disabled`);
                return emptyResult;
            }

            if (configuration.validateWithDefaultConfig === false && this.configCache.configuration!.isDefaultLinterConfig) {
                this.traceMethod('doRun', `No linting: linting with default tslint configuration is disabled`);
                return emptyResult;
            }

            if (isExcludedFromLinterOptions(linterConfiguration.linterConfiguration, filePath)) {
                this.traceMethod('doRun', `No linting: file is excluded using linterOptions.exclude`);
                return emptyResult;
            }

            let result: tslint.LintResult;

            const isTrustedWorkspace = configuration.workspaceLibraryExecution === WorkspaceLibraryExecution.Allow;

            // Only allow using a custom rules directory if the workspace has been trusted by the user
            const rulesDirectory = isTrustedWorkspace ? configuration.rulesDirectory : [];

            const options: tslint.ILinterOptions = {
                formatter: "json",
                fix: false,
                rulesDirectory,
                formattersDirectory: undefined,
            };
            if (configuration.traceLevel && configuration.traceLevel === 'verbose') {
                this.traceConfigurationFile(linterConfiguration.linterConfiguration);
            }

            // tslint writes warnings using console.warn, capture these warnings and send them to the client
            const originalConsoleWarn = console.warn;
            const captureWarnings = (message?: any) => {
                warnings.push(message);
                originalConsoleWarn(message);
            };
            console.warn = captureWarnings;

            const sanitizedLintConfiguration = { ...linterConfiguration.linterConfiguration } as IConfigurationFile;
            // Only allow using a custom rules directory if the workspace has been trusted by the user
            if (!isTrustedWorkspace) {
                sanitizedLintConfiguration.rulesDirectory = [];
            }

            try { // clean up if tslint crashes
                const linter = new library.tslint.Linter(options, typeof contents === 'string' ? undefined : contents);
                this.traceMethod('doRun', `Linting: start linting`);
                linter.lint(filePath, typeof contents === 'string' ? contents : '', sanitizedLintConfiguration);
                result = linter.getResult();
                this.traceMethod('doRun', `Linting: ended linting`);
            } finally {
                console.warn = originalConsoleWarn;
            }

            return {
                lintResult: result,
                warnings,
                workspaceFolderPath: configuration.workspaceFolderPath,
                configFilePath: linterConfiguration.path,
            };
        } finally {
            if (typeof cwdToRestore === 'string') {
                process.chdir(cwdToRestore);
            }
        }
    }

    /**
     * Check if `tslintPath` is next to the running TS version. This indicates that the user has
     * implicitly trusted the workspace since they are already running TS from it.
     */
    private isWorkspaceImplicitlyTrusted(tslintPath: string): boolean {
        const tsPath = process.argv[1];
        const nodeModulesPath = join(tsPath, '..', '..', '..');

        const rel = relative(nodeModulesPath, normalize(tslintPath));
        if (rel === `tslint${sep}lib${sep}index.js`) {
            return true;
        }
        return false;
    }

    private getConfiguration(uri: string, filePath: string, library: typeof tslint, configFileName: string | null): Configuration | undefined {
        this.traceMethod('getConfiguration', `Starting for ${uri}`);

        const config = this.configCache.get(filePath);
        if (config) {
            return config;
        }

        let isDefaultConfig = false;
        let linterConfiguration: tslint.Configuration.IConfigurationFile | undefined;

        const linter = library.Linter;
        if (linter.findConfigurationPath) {
            isDefaultConfig = linter.findConfigurationPath(configFileName, filePath) === undefined;
        }
        const configurationResult = linter.findConfiguration(configFileName, filePath);

        linterConfiguration = configurationResult.results;

        // In tslint version 5 the 'no-unused-variable' rules breaks the TypeScript language service plugin.
        // See https://github.com/Microsoft/TypeScript/issues/15344
        // Therefore we remove the rule from the configuration.
        if (linterConfiguration) {
            if (linterConfiguration.rules) {
                linterConfiguration.rules.delete('no-unused-variable');
            }
            if (linterConfiguration.jsRules) {
                linterConfiguration.jsRules.delete('no-unused-variable');
            }
        }

        const configuration: Configuration = {
            isDefaultLinterConfig: isDefaultConfig,
            linterConfiguration,
            path: configurationResult.path,
        };

        this.configCache.set(filePath, configuration);
        return this.configCache.configuration;
    }

    private fileIsExcluded(settings: RunConfiguration, filePath: string, cwd: string | undefined): boolean {
        if (settings.ignoreDefinitionFiles && filePath.endsWith('.d.ts')) {
            return true;
        }
        return settings.exclude.some(pattern => testForExclusionPattern(filePath, pattern, cwd));
    }

    private traceConfigurationFile(configuration: tslint.Configuration.IConfigurationFile | undefined) {
        if (!configuration) {
            this.trace("no tslint configuration");
            return;
        }
        this.trace("tslint configuration:" + util.inspect(configuration, undefined, 4));
    }

    private resolveTsLint(options: { nodePath: string | undefined; cwd: string | undefined; }): string | undefined {
        const nodePathKey = 'NODE_PATH';
        const app = [
            "console.log(require.resolve('tslint'));",
        ].join('');

        const env = process.env;
        const newEnv = Object.create(null);
        Object.keys(env).forEach(key => newEnv[key] = env[key]);
        if (options.nodePath) {
            newEnv[nodePathKey] = options.nodePath;
        }
        newEnv.ELECTRON_RUN_AS_NODE = '1';

        const spawnResults = cp.spawnSync(process.argv0, ['-e', app], { cwd: options.cwd, env: newEnv });
        return spawnResults.stdout.toString().trim() || undefined;
    }
}

function testForExclusionPattern(filePath: string, pattern: string, cwd: string | undefined): boolean {
    if (cwd) {
        // try first as relative
        const relPath = relative(cwd, filePath);
        if (minimatch(relPath, pattern, { dot: true })) {
            return true;
        }
        if (relPath === filePath) {
            return false;
        }
    }

    return minimatch(filePath, pattern, { dot: true });
}

function getInstallFailureMessage(filePath: string, packageManager: PackageManager): string {
    const localCommands = {
        npm: 'npm install tslint',
        pnpm: 'pnpm install tslint',
        yarn: 'yarn add tslint',
    };
    const globalCommands = {
        npm: 'npm install -g tslint',
        pnpm: 'pnpm install -g tslint',
        yarn: 'yarn global add tslint',
    };

    return [
        `Failed to load the TSLint library for '${filePath}'`,
        `To use TSLint, please install tslint using \'${localCommands[packageManager]}\' or globally using \'${globalCommands[packageManager]}\'.`,
        'Be sure to restart your editor after installing tslint.',
    ].join('\n');
}

function getWorkspaceNotTrustedMessage(filePath: string) {
    return [
        `Not using the local TSLint version found for '${filePath}'`,
        'To enable code execution from the current workspace you must enable workspace library execution.',
    ].join('\n');
}

function isJsDocument(filePath: string): boolean {
    return /\.(jsx?|mjs)$/i.test(filePath);
}

function isExcludedFromLinterOptions(
    config: tslint.Configuration.IConfigurationFile | undefined,
    fileName: string,
): boolean {
    if (config === undefined || config.linterOptions === undefined || config.linterOptions.exclude === undefined) {
        return false;
    }
    return config.linterOptions.exclude.some(pattern => testForExclusionPattern(fileName, pattern, undefined));
}

function getConfigurationFailureMessage(err: any): string {
    let errorMessage = `unknown error`;
    if (typeof err.message === 'string' || err.message instanceof String) {
        errorMessage = err.message;
    }
    return `Cannot read tslint configuration - '${errorMessage}'`;
}
