import * as ts_module from "../node_modules/typescript/lib/tsserverlibrary";
import * as tslint from 'tslint';
import * as path from 'path';
import * as mockRequire from 'mock-require';

import { TsLintRunner, RunResult } from '../tslint-runner'

// Settings for the plugin section in tsconfig.json
interface Settings {
    alwaysShowRuleFailuresAsWarnings?: boolean;
    ignoreDefinitionFiles?: boolean;
    configFile?: string;
    disableNoUnusedVariableRule?: boolean  // support to enable/disable the workaround for https://github.com/Microsoft/TypeScript/issues/15344
    supressWhileTypeErrorsPresent: boolean;
    mockTypeScriptVersion: boolean;
}

const pluginId = 'tslint-language-service';

const TSLINT_ERROR_CODE = 100000;

class Logger {
    public static forPlugin(info: ts.server.PluginCreateInfo) {
        return new Logger(info.project.projectService.logger);
    }

    private constructor(
        private readonly _logger: ts.server.Logger
    ) { }

    public info(message: string) {
        this._logger.info(`[${pluginId}] ${JSON.stringify(message)}`);
    }
}

class ConfigFileWatcher {
    private readonly _watchedConfigs = new Set<string>();

    public constructor(
        private readonly ts: typeof ts_module,
        private readonly onChange: (fileName: string) => void
    ) { }

    public ensureWatching(file: string) {
        if (!this.ts.sys.watchFile) {
            return;
        }

        if (this._watchedConfigs.has(file)) {
            return;
        }

        this._watchedConfigs.add(file);

        this.ts.sys.watchFile(file, (fileName: string, eventKind: ts.FileWatcherEventKind) => {
            if (eventKind === this.ts.FileWatcherEventKind.Changed) {
                this.onChange(fileName);
            }
        });
    }
}

function init(modules: { typescript: typeof ts_module }) {
    const ts = modules.typescript;

    let codeFixActions = new Map<string, Map<string, tslint.RuleFailure>>();

    const getSupportedCodeFixes = ts.getSupportedCodeFixes.bind(ts);
    ts.getSupportedCodeFixes = () => {
        return getSupportedCodeFixes().concat(TSLINT_ERROR_CODE);
    };

    function fixRelativeConfigFilePath(config: Settings, projectRoot: string): Settings {
        if (!config.configFile) {
            return config;
        }
        if (path.isAbsolute(config.configFile)) {
            return config;
        }
        config.configFile = path.join(projectRoot, config.configFile);
        return config;
    }

    function create(info: ts.server.PluginCreateInfo) {
        const logger = Logger.forPlugin(info);

        logger.info('loaded');
        let config: Settings = fixRelativeConfigFilePath(info.config, info.project.getCurrentDirectory());

        if (config.mockTypeScriptVersion) {
            mockRequire('typescript', ts);
        }

        const runner = new TsLintRunner(() => { });

        // Set up decorator
        const proxy = Object.create(null) as ts.LanguageService;
        const oldLS = info.languageService;
        for (const k in oldLS) {
            (<any>proxy)[k] = function () {
                return (<any>oldLS)[k].apply(oldLS, arguments);
            }
        }

        // key to identify a rule failure
        function computeKey(start: number, end: number): string {
            return `[${start},${end}]`;
        }

        // Watch config file for changes
        if (info.project instanceof ts.server.ConfiguredProject && ts.sys.watchFile) {
            const configFile = info.project.getConfigFilePath();
            logger.info(`Found configured project: ${configFile}`);

            ts.sys.watchFile(configFile, (_fileName: string, eventKind: ts.FileWatcherEventKind) => {
                if (eventKind !== ts.FileWatcherEventKind.Changed) {
                    return;
                }

                logger.info('TSConfig file changed');

                const configFileResult = ts.readConfigFile(configFile, ts.sys.readFile);
                if (configFileResult.error || !configFileResult.config) {
                    logger.info(`Error reading config file: ${configFileResult.error}`);
                    return;
                }

                if (!configFileResult.config.compilerOptions || !Array.isArray(configFileResult.config.compilerOptions.plugins)) {
                    return;
                }

                const pluginSettings = (configFileResult.config.compilerOptions.plugins as Array<any>).find(x => x.name === pluginId);
                if (!pluginSettings) {
                    return;
                }

                logger.info(`Updating config settings: ${JSON.stringify(pluginSettings)}`);
                config = fixRelativeConfigFilePath(pluginSettings, info.project.getCurrentDirectory());
                info.project.refreshDiagnostics();
            });
        }

        // tslint:disable-next-line:no-unused-expression
        const configFileWatcher = new ConfigFileWatcher(ts, filePath => {
            logger.info('TSlint file changed');
            runner.onConfigFileChange(filePath);
            info.project.refreshDiagnostics();
        });

        function makeDiagnostic(problem: tslint.RuleFailure, file: ts.SourceFile): ts.Diagnostic {
            let message = (problem.getRuleName() !== null)
                ? `${problem.getFailure()} (${problem.getRuleName()})`
                : `${problem.getFailure()}`;

            let category;
            if (config.alwaysShowRuleFailuresAsWarnings === true) {
                category = ts.DiagnosticCategory.Warning;
            } else if ((<any>problem).getRuleSeverity && (<any>problem).getRuleSeverity() === 'error') {
                // tslint5 supports to assign severities to rules
                category = ts.DiagnosticCategory.Error;
            } else {
                category = ts.DiagnosticCategory.Warning;
            }

            let diagnostic: ts.Diagnostic = {
                file: file,
                start: problem.getStartPosition().getPosition(),
                length: problem.getEndPosition().getPosition() - problem.getStartPosition().getPosition(),
                messageText: message,
                category: category,
                source: 'tslint',
                code: TSLINT_ERROR_CODE
            };
            return diagnostic;
        }

        function replacementsAreEmpty(fix: tslint.Fix | undefined): boolean {
            // in tslint 4 a Fix has a replacement property witht the Replacements
            if ((<any>fix).replacements) {
                return (<any>fix).replacements.length === 0;
            }
            // tslint 5
            if (Array.isArray(fix)) {
                return fix.length === 0;
            }
            return false;
        }

        function recordCodeAction(problem: tslint.RuleFailure, file: ts.SourceFile) {
            let fix: tslint.Fix | undefined = undefined;

            // tslint can return a fix with an empty replacements array, these fixes are ignored
            if (problem.getFix && problem.getFix() && !replacementsAreEmpty(problem.getFix())) { // tslint fixes are not available in tslint < 3.17
                fix = problem.getFix(); // createAutoFix(problem, document, problem.getFix());
            }

            if (!fix) {
                return;
            }

            let documentAutoFixes: Map<string, tslint.RuleFailure> | undefined = codeFixActions.get(file.fileName);
            if (!documentAutoFixes) {
                documentAutoFixes = new Map<string, tslint.RuleFailure>();
                codeFixActions.set(file.fileName, documentAutoFixes);
            }
            documentAutoFixes.set(computeKey(problem.getStartPosition().getPosition(), problem.getEndPosition().getPosition()), problem);
        }

        function convertReplacementToTextChange(repl: tslint.Replacement): ts.TextChange {
            return {
                newText: repl.text,
                span: { start: repl.start, length: repl.length }
            };
        }

        function problemToFileTextChange(problem: tslint.RuleFailure, fileName: string): ts_module.FileTextChanges {
            let fix = problem.getFix();
            let replacements: tslint.Replacement[] = getReplacements(fix);

            return {
                fileName: fileName,
                textChanges: replacements.map(each => convertReplacementToTextChange(each)),
            }
        }

        function addRuleFailureFix(fixes: ts_module.CodeAction[], problem: tslint.RuleFailure, fileName: string) {
            fixes.push({
                description: `Fix '${problem.getRuleName()}'`,
                changes: [problemToFileTextChange(problem, fileName)]
            });
        }

        /* Generate a code action that fixes all instances of ruleName.  */
        function addRuleFailureFixAll(fixes: ts_module.CodeAction[], ruleName: string, problems: Map<string, tslint.RuleFailure>, fileName: string) {
            const changes: ts_module.FileTextChanges[] = [];

            for (const problem of problems.values()) {
                if (problem.getRuleName() === ruleName) {
                    changes.push(problemToFileTextChange(problem, fileName));
                }
            }

            /* No need for this action if there's only one instance.  */
            if (changes.length < 2) {
                return;
            }

            fixes.push({
                description: `Fix all '${ruleName}'`,
                changes: changes,
            });
        }

        function addDisableRuleFix(fixes: ts_module.CodeAction[], problem: tslint.RuleFailure, fileName: string, file: ts_module.SourceFile) {
            fixes.push({
                description: `Disable rule '${problem.getRuleName()}'`,
                changes: [{
                    fileName: fileName,
                    textChanges: [{
                        newText: `// tslint:disable-next-line:${problem.getRuleName()}\n`,
                        span: { start: file.getLineStarts()[problem.getStartPosition().getLineAndCharacter().line], length: 0 }
                    }]
                }]
            });
        }

        function addAllAutoFixable(fixes: ts_module.CodeAction[], documentFixes: Map<string, tslint.RuleFailure>, fileName: string) {
            const allReplacements = getNonOverlappingReplacements(documentFixes);
            fixes.push({
                description: `Fix all auto-fixable tslint failures`,
                changes: [{
                    fileName: fileName,
                    textChanges: allReplacements.map(each => convertReplacementToTextChange(each))
                }]
            });
        }


        proxy.getSemanticDiagnostics = (fileName: string) => {
            const prior = oldLS.getSemanticDiagnostics(fileName);

            if (config.supressWhileTypeErrorsPresent && prior.length > 0) {
                return prior;
            }

            try {
                logger.info(`Computing tslint semantic diagnostics...`);
                if (codeFixActions.has(fileName)) {
                    codeFixActions.delete(fileName);
                }

                if (config.ignoreDefinitionFiles === true && fileName.endsWith('.d.ts')) {
                    return prior;
                }

                let result: RunResult;
                try { // protect against tslint crashes
                    result = runner.runTsLint(fileName, oldLS.getProgram() || '', {
                        configFile: config.configFile,
                        ignoreDefinitionFiles: config.ignoreDefinitionFiles
                    });
                    if (result.configFilePath) {
                        configFileWatcher.ensureWatching(result.configFilePath);
                    }
                } catch (err) {
                    let errorMessage = `unknown error`;
                    if (typeof err.message === 'string' || err.message instanceof String) {
                        errorMessage = <string>err.message;
                    }
                    info.project.projectService.logger.info('tslint error ' + errorMessage);
                    return prior;
                }

                for (const warning of result.warnings) {
                    logger.info(`[tslint] ${warning}`);
                }

                if (result.lintResult.failures.length > 0) {
                    const tslintProblems = runner.filterProblemsForFile(fileName, result.lintResult.failures);
                    if (tslintProblems && tslintProblems.length) {
                        const file = oldLS.getProgram()!.getSourceFile(fileName)!;
                        const diagnostics = prior ? [...prior] : [];
                        tslintProblems.forEach(problem => {
                            diagnostics.push(makeDiagnostic(problem, file));
                            recordCodeAction(problem, file);
                        });
                        return diagnostics;
                    }
                }
            } catch (e) {
                info.project.projectService.logger.info(`tslint-language service error: ${e.toString()}`);
                info.project.projectService.logger.info(`Stack trace: ${e.stack}`);
            }
            return prior;
        };

        proxy.getCodeFixesAtPosition = function (fileName: string, start: number, end: number, errorCodes: number[], formatOptions: ts.FormatCodeSettings, userPreferences: ts.UserPreferences): ReadonlyArray<ts.CodeFixAction> {
            let prior = oldLS.getCodeFixesAtPosition(fileName, start, end, errorCodes, formatOptions, userPreferences);
            if (config.supressWhileTypeErrorsPresent && prior.length > 0) {
                return prior;
            }

            info.project.projectService.logger.info("tslint-language-service getCodeFixes " + errorCodes[0]);
            let documentFixes = codeFixActions.get(fileName);

            if (documentFixes) {
                const fixes = prior ? [...prior] : [];

                let problem = documentFixes.get(computeKey(start, end));
                if (problem) {
                    addRuleFailureFix(fixes, problem, fileName);
                    addRuleFailureFixAll(fixes, problem.getRuleName(), documentFixes, fileName);
                }
                addAllAutoFixable(fixes, documentFixes, fileName);
                if (problem) {
                    addDisableRuleFix(fixes, problem, fileName, oldLS.getProgram()!.getSourceFile(fileName)!);
                }

                return fixes;
            }

            return prior;
        };
        return proxy;
    }

    return { create };
}
export = init;

function getReplacements(fix: tslint.Fix | undefined): tslint.Replacement[] {
    let replacements: tslint.Replacement[] | null = null;
    // in tslint4 a Fix has a replacement property with the Replacements
    if ((<any>fix).replacements) {
        // tslint4
        replacements = (<any>fix).replacements;
    } else {
        // in tslint 5 a Fix is a Replacement | Replacement[]                  
        if (!Array.isArray(fix)) {
            replacements = [<any>fix];
        } else {
            replacements = fix;
        }
    }
    return replacements || [];
}

function getReplacement(failure: tslint.RuleFailure, at: number): tslint.Replacement {
    return getReplacements(failure.getFix())[at];
}

function sortFailures(failures: tslint.RuleFailure[]): tslint.RuleFailure[] {
    // The failures.replacements are sorted by position, we sort on the position of the first replacement
    return failures.sort((a, b) => {
        return getReplacement(a, 0).start - getReplacement(b, 0).start;
    });
}

function getNonOverlappingReplacements(documentFixes: Map<string, tslint.RuleFailure>): tslint.Replacement[] {
    function overlaps(a: tslint.Replacement, b: tslint.Replacement): boolean {
        return a.end >= b.start;
    }

    let sortedFailures = sortFailures([...documentFixes.values()]);
    let nonOverlapping: tslint.Replacement[] = [];
    for (let i = 0; i < sortedFailures.length; i++) {
        let replacements = getReplacements(sortedFailures[i].getFix());
        if (i === 0 || !overlaps(nonOverlapping[nonOverlapping.length - 1], replacements[0])) {
            nonOverlapping.push(...replacements)
        }
    }
    return nonOverlapping;
}