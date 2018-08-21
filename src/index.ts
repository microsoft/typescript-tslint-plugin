import * as ts_module from "../node_modules/typescript/lib/tsserverlibrary";
import * as tslint from 'tslint';
import * as path from 'path';
import * as mockRequire from 'mock-require';

// Settings for the plugin section in tsconfig.json
interface Settings {
    alwaysShowRuleFailuresAsWarnings?: boolean;
    ignoreDefinitionFiles?: boolean;
    configFile?: string;
    disableNoUnusedVariableRule?: boolean  // support to enable/disable the workaround for https://github.com/Microsoft/TypeScript/issues/15344
    supressWhileTypeErrorsPresent: boolean;
    mockTypeScriptVersion: boolean;
}

const TSLINT_ERROR_CODE = 100000;

function init(modules: { typescript: typeof ts_module }) {
    const ts = modules.typescript;

    let codeFixActions = new Map<string, Map<string, tslint.RuleFailure>>();
    let registeredCodeFixes = false;

    let configCache = {
        filePath: <string>null,
        configuration: <any>null,
        isDefaultConfig: false,
        configFilePath: <string>null
    };

    // Work around the lack of API to register a CodeFix
    function registerCodeFix(action: codefix.CodeFix) {
        return (ts as any).codefix.registerCodeFix(action);
    }

    if (!registeredCodeFixes && ts && (ts as any).codefix) {
        registerCodeFixes(registerCodeFix);
        registeredCodeFixes = true;
    }

    function registerCodeFixes(registerCodeFix: (action: codefix.CodeFix) => void) {
        // Code fix for that is used for all tslint fixes
        registerCodeFix({
            errorCodes: [TSLINT_ERROR_CODE],
            getCodeActions: (_context: any) => {
                return null;
            }
        });
    }

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
        info.project.projectService.logger.info("tslint-language-service loaded");
        let config: Settings = fixRelativeConfigFilePath(info.config, info.project.getCurrentDirectory());
        let configuration: tslint.Configuration.IConfigurationFile = null;

        if(config.mockTypeScriptVersion) {
            mockRequire('typescript', ts);
        }
        const tslint = require('tslint')

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

        /**
         * Filter failures for the given document
         */
        function filterProblemsForDocument(documentPath: string, failures: tslint.RuleFailure[]): tslint.RuleFailure[] {
            let normalizedPath = path.normalize(documentPath);
            // we only show diagnostics targetting this open document, some tslint rule return diagnostics for other documents/files
            let normalizedFiles = new Map<string, string>();
            return failures.filter(each => {
                let fileName = each.getFileName();
                if (!normalizedFiles.has(fileName)) {
                    normalizedFiles.set(fileName, path.normalize(fileName));
                }
                return normalizedFiles.get(fileName) === normalizedPath;
            });
        }

        function replacementsAreEmpty(fix: tslint.Fix): boolean {
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
            let fix: tslint.Fix = null;

            // tslint can return a fix with an empty replacements array, these fixes are ignored
            if (problem.getFix && problem.getFix() && !replacementsAreEmpty(problem.getFix())) { // tslint fixes are not available in tslint < 3.17
                fix = problem.getFix(); // createAutoFix(problem, document, problem.getFix());
            }

            if (!fix) {
                return;
            }

            let documentAutoFixes: Map<string, tslint.RuleFailure> = codeFixActions.get(file.fileName);
            if (!documentAutoFixes) {
                documentAutoFixes = new Map<string, tslint.RuleFailure>();
                codeFixActions.set(file.fileName, documentAutoFixes);
            }
            documentAutoFixes.set(computeKey(problem.getStartPosition().getPosition(), problem.getEndPosition().getPosition()), problem);
        }

        function getConfigurationFailureMessage(err: any): string {
            let errorMessage = `unknown error`;
            if (typeof err.message === 'string' || err.message instanceof String) {
                errorMessage = <string>err.message;
            }
            return `tslint: Cannot read tslint configuration - '${errorMessage}'`;
        }

        function getConfiguration(filePath: string, configFileName: string): any {
            if (configCache.configuration && configCache.filePath === filePath) {
                return configCache.configuration;
            }

            let isDefaultConfig = false;
            let configuration;
            let configFilePath = null;

            isDefaultConfig = tslint.Configuration.findConfigurationPath(configFileName, filePath) === undefined;
            let configurationResult = tslint.Configuration.findConfiguration(configFileName, filePath);

            // between tslint 4.0.1 and tslint 4.0.2 the attribute 'error' has been removed from IConfigurationLoadResult
            // in 4.0.2 findConfiguration throws an exception as in version ^3.0.0
            if ((<any>configurationResult).error) {
                throw (<any>configurationResult).error;
            }
            configuration = configurationResult.results;

            // In tslint version 5 the 'no-unused-variable' rules breaks the TypeScript language service plugin.
            // See https://github.com/Microsoft/TypeScript/issues/15344
            // Therefore we remove the rule from the configuration.
            //
            // In tslint 5 the rules are stored in a Map, in earlier versions they were stored in an Object
            if (config.disableNoUnusedVariableRule === true || config.disableNoUnusedVariableRule === undefined) {
                if (configuration.rules && configuration.rules instanceof Map) {
                    configuration.rules.delete('no-unused-variable');
                }
                if (configuration.jsRules && configuration.jsRules instanceof Map) {
                    configuration.jsRules.delete('no-unused-variable');
                }
            }

            configFilePath = configurationResult.path;

            configCache = {
                filePath: filePath,
                isDefaultConfig: isDefaultConfig,
                configuration: configuration,
                configFilePath: configFilePath
            };
            return configCache.configuration;
        }
        
        function captureWarnings(message?: any): void {
            // TODO log to a user visible log and not only the TS-Server log
            info.project.projectService.logger.info(`[tslint] ${message}`);
        }

        function convertReplacementToTextChange(repl: tslint.Replacement): ts.TextChange {
            return {
                newText: repl.text,
                span: { start: repl.start, length: repl.length }
            };
        }
        
        function getReplacements(fix: tslint.Fix): tslint.Replacement[]{
            let replacements: tslint.Replacement[] = null;
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
            return replacements;
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

        function addOpenConfigurationFix(fixes: ts_module.CodeAction[]) {
            // the Open Configuration code action is disabled since there is no specified API to open an editor
            let openConfigFixEnabled = false;
            if (openConfigFixEnabled && configCache && configCache.configFilePath) {
                fixes.push({
                    description: `Open tslint.json`,
                    changes: [{
                        fileName: configCache.configFilePath,
                        textChanges: []
                    }]
                });
            }
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

        function getReplacement(failure: tslint.RuleFailure, at:number): tslint.Replacement {
            return getReplacements(failure.getFix())[at];
        }

        function sortFailures(failures: tslint.RuleFailure[]):tslint.RuleFailure[] {
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

        proxy.getSemanticDiagnostics = (fileName: string) => {
            const prior = oldLS.getSemanticDiagnostics(fileName);

            if (config.supressWhileTypeErrorsPresent && prior.length > 0) {
                return prior;
            }

            try {
                info.project.projectService.logger.info(`Computing tslint semantic diagnostics...`);
                if (codeFixActions.has(fileName)) {
                    codeFixActions.delete(fileName);
                }

                if (config.ignoreDefinitionFiles === true && fileName.endsWith('.d.ts')) {
                    return prior;
                }

                try {
                    configuration = getConfiguration(fileName, config.configFile);
                } catch (err) {
                    // TODO: show the reason for the configuration failure to the user and not only in the log
                    // https://github.com/Microsoft/TypeScript/issues/15913
                    info.project.projectService.logger.info(getConfigurationFailureMessage(err))
                    return prior;
                }

                let result: tslint.LintResult;

                // tslint writes warning messages using console.warn()
                // capture the warnings and write them to the tslint plugin log
                let warn = console.warn;
                console.warn = captureWarnings;

                try { // protect against tslint crashes
                    // TODO the types of the Program provided by tsserver libary are not compatible with the one provided by typescript
                    // casting away the type
                    let options: tslint.ILinterOptions = { fix: false };
                    let linter = new tslint.Linter(options, <any>oldLS.getProgram());
                    linter.lint(fileName, "", configuration);
                    result = linter.getResult();
                } catch (err) {
                    let errorMessage = `unknown error`;
                    if (typeof err.message === 'string' || err.message instanceof String) {
                        errorMessage = <string>err.message;
                    }
                    info.project.projectService.logger.info('tslint error ' + errorMessage);
                    return prior;
                } finally {
                    console.warn = warn;
                }

                if (result.failures.length > 0) {
                    const tslintProblems = filterProblemsForDocument(fileName, result.failures);
                    if (tslintProblems && tslintProblems.length) {
                        const file = oldLS.getProgram().getSourceFile(fileName);
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
                    addOpenConfigurationFix(fixes);
                    addDisableRuleFix(fixes, problem, fileName, oldLS.getProgram().getSourceFile(fileName));
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

/* @internal */
// work around for missing API to register a code fix
namespace codefix {

    export interface CodeFix {
        errorCodes: number[];
        getCodeActions(context: any): ts.CodeAction[] | undefined;
    }
}
