import * as ts_module from "../node_modules/typescript/lib/tsserverlibrary";
import * as tslint from 'tslint';
import * as path from 'path';

let codeFixActions = new Map<string, Map<string, tslint.RuleFailure>>();
let registeredCodeFixes = false;

let configCache = {
    filePath: <string>null,
    configuration: <any>null,
    isDefaultConfig: false,
    configFilePath: <string>null
};

interface Settings {
    alwaysShowRuleFailuresAsWarnings?: boolean;
    ignoreDefinitionFiles?: boolean;
    configFile?: string;
    disableNoUnusedVariableRule?: boolean  // support to enable/disable the workaround for https://github.com/Microsoft/TypeScript/issues/15344
}

//TODO we "steal"" an error code with a registered code fix. 2515 = implement inherited abstract class
const TSLINT_ERROR_CODE = 2515;

function init(modules: { typescript: typeof ts_module }) {
    const ts = modules.typescript;

    // By waiting for that TypeScript provides an API to register CodeFix
    // we define a registerCodeFix which uses the existing ts.codefix namespace.
    function registerCodeFix(action: codefix.CodeFix) {
        return (ts as any).codefix.registerCodeFix(action);
    }

    if (!registeredCodeFixes && ts && (ts as any).codefix) {
        registerCodeFixes(registerCodeFix);
        registeredCodeFixes = true;
    }

    function registerCodeFixes(registerCodeFix: (action: codefix.CodeFix) => void) {
        // Code fix for tslint fixes
        registerCodeFix({
            errorCodes: [TSLINT_ERROR_CODE],
            getCodeActions: (_context: any) => {
                return null;
            }
        });
    }

    function create(info: ts.server.PluginCreateInfo) {

        info.project.projectService.logger.info("tslint-language-service loaded");
        let config: Settings = info.config;
        let configuration: tslint.Configuration.IConfigurationFile = null;

        // Set up decorator
        const proxy = Object.create(null) as ts.LanguageService;
        const oldLS = info.languageService;
        for (const k in oldLS) {
            (<any>proxy)[k] = function () {
                return (<any>oldLS)[k].apply(oldLS, arguments);
            }
        }

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

        proxy.getSemanticDiagnostics = (fileName: string) => {
            let prior = oldLS.getSemanticDiagnostics(fileName);
            if (prior === undefined) {
                prior = [];
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
                    // this should not happen since we guard against incorrect configurations
                    // showConfigurationFailure(conn, err);
                    return prior;
                }

                let result: tslint.LintResult;
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
                }

                if (result.failures.length > 0) {
                    const tslintProblems = filterProblemsForDocument(fileName, result.failures);
                    if (tslintProblems && tslintProblems.length) {
                        const file = oldLS.getProgram().getSourceFile(fileName);
                        prior.push.apply(prior, tslintProblems.map(d => makeDiagnostic(d, file)));
                        tslintProblems.forEach(problem => {
                            recordCodeAction(problem, file);
                        });
                    }
                }
            } catch (e) {
                info.project.projectService.logger.info(`tslint-language service error: ${e.toString()}`);
                info.project.projectService.logger.info(`Stack trace: ${e.stack}`);
            }
            return prior;
        };

        proxy.getCodeFixesAtPosition = function (fileName: string, start: number, end: number, errorCodes: number[], formatOptions: ts.FormatCodeSettings): ts.CodeAction[] {
            let prior = oldLS.getCodeFixesAtPosition(fileName, start, end, errorCodes, formatOptions);
            if (prior === undefined) {
                prior = [];
            }
            info.project.projectService.logger.info("tslint-language-service getCodeFixes " + errorCodes[0]);
            let documentFixes = codeFixActions.get(fileName);

            if (documentFixes) {
                let problem = documentFixes.get(computeKey(start, end));
                if (problem) {
                    let fix = problem.getFix();
                    let replacements: tslint.Replacement[] = null;
                    // in tslint4 a Fix has a replacement property with the Replacements
                    if ((<any>fix).replacements) {
                        // tslint4
                        replacements = (<any>fix).replacements;
                    } else {
                        // in tslint 5 a Fix is a Replacement | Replacement[]                  
                        if (!Array.isArray(fix)) {
                            replacements = [fix];
                        } else {
                            replacements = fix;
                        }
                    }

                    // Add tslint replacements codefix
                    const textChanges = replacements.map(each => convertReplacementToTextChange(each));
                    prior.push({
                        description: `Fix '${problem.getRuleName()}'`,
                        changes: [{
                            fileName: fileName,
                            textChanges: textChanges
                        }]
                    });
                    const file = oldLS.getProgram().getSourceFile(fileName);
                    // Add disable tslint rule codefix
                    prior.push({
                        description: `Disable rule '${problem.getRuleName()}'`,
                        changes: [{
                            fileName: fileName,
                            textChanges: [{
                                newText: `// tslint:disable-next-line:${problem.getRuleName()}\n`,
                                span: { start: file.getLineStarts()[problem.getStartPosition().getLineAndCharacter().line], length: 0 }
                            }
                            ]
                        }]
                    });
                }
            }
            // Add "Go to rule definition" tslint.json codefix
            /* Comment this codefix, because it doesn't work with VSCode because textChanges is empty.
               Hope one day https://github.com/angelozerr/tslint-language-service/issues/4 will be supported.
                 
               if (configCache && configCache.configFilePath) {
                prior.push({
                    description: `Open tslint.json`,
                    changes: [{
                        fileName: configCache.configFilePath,
                        textChanges: []
                    }]
                });
            }*/
            return prior;
        };
        return proxy;
    }

    return { create };
}

export = init;

function convertReplacementToTextChange(repl: tslint.Replacement): ts.TextChange {
    return {
        newText: repl.text,
        span: { start: repl.start, length: repl.length }
    };
}

/* @internal */
namespace codefix {

    export interface CodeFix {
        errorCodes: number[];
        getCodeActions(context: any): ts.CodeAction[] | undefined;
    }
}