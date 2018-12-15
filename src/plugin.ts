import * as tslint from 'tslint';
import * as ts_module from 'typescript/lib/tsserverlibrary';
import { TSLINT_ERROR_CODE, TSLINT_ERROR_SOURCE } from './config';
import { ConfigFileWatcher } from './configFileWatcher';
import { Logger } from './logger';
import { RunResult, TsLintRunner } from './runner';
import { ConfigurationManager } from './settings';
import { getNonOverlappingReplacements, filterProblemsForFile, getReplacements } from './runner/failures';

const isTsLintLanguageServiceMarker = Symbol('__isTsLintLanguageServiceMarker__');

interface Problem {
    failure: tslint.RuleFailure;
    fixable: boolean;
}

class ProblemMap {
    private readonly _map = new Map<string, Problem>();

    public get(start: number, end: number) {
        return this._map.get(this.key(start, end));
    }

    public set(start: number, end: number, problem: Problem): void {
        this._map.set(this.key(start, end), problem);
    }

    public values() {
        return this._map.values();
    }

    // key to identify a rule failure
    private key(start: number, end: number): string {
        return `[${start},${end}]`;
    }
}

export class TSLintPlugin {
    private readonly codeFixActions = new Map<string, ProblemMap>();
    private readonly configFileWatcher: ConfigFileWatcher;
    private readonly runner: TsLintRunner;

    public constructor(
        private readonly ts: typeof ts_module,
        private readonly logger: Logger,
        private readonly project: ts_module.server.Project,
        private readonly configurationManager: ConfigurationManager,
    ) {
        this.logger.info('loaded');

        this.runner = new TsLintRunner(message => { this.logger.info(message); });

        this.configFileWatcher = new ConfigFileWatcher(ts, filePath => {
            this.logger.info('TSlint file changed');
            this.runner.onConfigFileChange(filePath);
            this.project.refreshDiagnostics();
        });

        this.configurationManager.onUpdatedConfig(() => {
            this.logger.info('TSConfig configuration changed');
            project.refreshDiagnostics();
        });
    }

    public decorate(languageService: ts.LanguageService) {
        if ((languageService as any)[isTsLintLanguageServiceMarker]) {
            // Already decorated
            return;
        }

        const oldGetSupportedCodeFixes = this.ts.getSupportedCodeFixes.bind(this.ts);
        this.ts.getSupportedCodeFixes = (): string[] => {
            return [
                ... oldGetSupportedCodeFixes(),
                '' + TSLINT_ERROR_CODE,
            ];
        };

        const intercept: Partial<ts.LanguageService> = Object.create(null);

        const oldGetSemanticDiagnostics = languageService.getSemanticDiagnostics.bind(languageService);
        intercept.getSemanticDiagnostics = (fileName: string) => {
            return this.getSemanticDiagnostics(oldGetSemanticDiagnostics, fileName);
        };

        const oldGetCodeFixesAtPosition = languageService.getCodeFixesAtPosition.bind(languageService);
        intercept.getCodeFixesAtPosition = (fileName: string, start: number, end: number, errorCodes: number[], formatOptions: ts.FormatCodeSettings, userPreferences: ts.UserPreferences): ReadonlyArray<ts.CodeFixAction> => {
            return this.getCodeFixesAtPosition(oldGetCodeFixesAtPosition, fileName, start, end, errorCodes, formatOptions, userPreferences);
        };

        return new Proxy(languageService, {
            get: (target: any, property: string | symbol) => {
                if (property === isTsLintLanguageServiceMarker) {
                    return true;
                }
                return (intercept as any)[property] || target[property];
            },
        });
    }

    private getSemanticDiagnostics(
        delegate: (fileName: string) => ts_module.Diagnostic[],
        fileName: string,
    ): ts_module.Diagnostic[] {
        const diagnostics = delegate(fileName);

        const config = this.configurationManager.config;
        if (diagnostics.length > 0 && config.suppressWhileTypeErrorsPresent) {
            return diagnostics;
        }

        try {
            this.logger.info(`Computing tslint semantic diagnostics for '${fileName}'`);

            if (this.codeFixActions.has(fileName)) {
                this.codeFixActions.delete(fileName);
            }

            if (config.ignoreDefinitionFiles && fileName.endsWith('.d.ts')) {
                return diagnostics;
            }

            let result: RunResult;
            try { // protect against tslint crashes
                result = this.runner.runTsLint(fileName, this.getProgram(), {
                    configFile: config.configFile,
                    ignoreDefinitionFiles: config.ignoreDefinitionFiles,
                    jsEnable: config.jsEnable,
                    exclude: config.exclude,
                });
                if (result.configFilePath) {
                    this.configFileWatcher.ensureWatching(result.configFilePath);
                }
            } catch (err) {
                let errorMessage = `unknown error`;
                if (typeof err.message === 'string' || err.message instanceof String) {
                    errorMessage = err.message as string;
                }
                this.logger.info('tslint error ' + errorMessage);
                return diagnostics;
            }

            const file = this.getProgram().getSourceFile(fileName)!;

            for (const warning of result.warnings) {
                this.logger.info(`[tslint] ${warning}`);
            }

            const tslintProblems = filterProblemsForFile(fileName, result.lintResult.failures);
            for (const problem of tslintProblems) {
                diagnostics.push(this.makeDiagnostic(problem, file));
                this.recordCodeAction(problem, file);
            }
        } catch (e) {
            this.logger.info(`tslint-language service error: ${e.toString()}`);
            this.logger.info(`Stack trace: ${e.stack}`);
        }

        return diagnostics;
    }

    private getCodeFixesAtPosition(
        delegate: ts.LanguageService['getCodeFixesAtPosition'],
        fileName: string,
        start: number,
        end: number,
        errorCodes: number[],
        formatOptions: ts.FormatCodeSettings,
        userPreferences: ts.UserPreferences
    ): ReadonlyArray<ts.CodeFixAction> {
        const fixes = Array.from(delegate(fileName, start, end, errorCodes, formatOptions, userPreferences));

        if (this.configurationManager.config.suppressWhileTypeErrorsPresent && fixes.length > 0) {
            return fixes;
        }

        this.logger.info(`getCodeFixes ${errorCodes[0]}`);

        const documentFixes = this.codeFixActions.get(fileName);
        if (documentFixes) {
            const problem = documentFixes.get(start, end);
            if (problem && problem.fixable) {
                const fix = problem.failure.getFix();
                if (fix) {
                    fixes.push(this.getRuleFailureQuickFix(problem.failure, fileName));

                    const fixAll = this.getRuleFailureFixAllQuickFix(problem.failure.getRuleName(), documentFixes, fileName);
                    if (fixAll) {
                        fixes.push(fixAll);
                    }
                }
            }

            fixes.push(this.getFixAllAutoFixableQuickFix(documentFixes, fileName));

            if (problem) {
                fixes.push(this.getDisableRuleQuickFix(problem.failure, fileName, this.getProgram().getSourceFile(fileName)!));
            }
        }

        return fixes;
    }

    private recordCodeAction(failure: tslint.RuleFailure, file: ts.SourceFile) {
        // tslint can return a fix with an empty replacements array, these fixes are ignored
        const fixable = !!(failure.getFix && failure.getFix() && !replacementsAreEmpty(failure.getFix()));

        let documentAutoFixes = this.codeFixActions.get(file.fileName);
        if (!documentAutoFixes) {
            documentAutoFixes = new ProblemMap();
            this.codeFixActions.set(file.fileName, documentAutoFixes);
        }
        documentAutoFixes.set(failure.getStartPosition().getPosition(), failure.getEndPosition().getPosition(), { failure, fixable });
    }

    private getRuleFailureQuickFix(failure: tslint.RuleFailure, fileName: string): ts_module.CodeFixAction {
        return {
            description: `Fix: ${failure.getFailure()}`,
            fixName: '',
            changes: [failureToFileTextChange(failure, fileName)],
        };
    }

    /**
     * Generate a code action that fixes all instances of ruleName.
     */
    private getRuleFailureFixAllQuickFix(ruleName: string, problems: ProblemMap, fileName: string): ts_module.CodeFixAction | undefined {
        const changes: ts_module.FileTextChanges[] = [];

        for (const problem of problems.values()) {
            if (problem.fixable) {
                if (problem.failure.getRuleName() === ruleName) {
                    changes.push(failureToFileTextChange(problem.failure, fileName));
                }
            }
        }

        // No need for this action if there's only one instance.
        if (changes.length < 2) {
            return undefined;
        }

        return {
            description: `Fix all '${ruleName}'`,
            fixName: '',
            changes,
        };
    }

    private getDisableRuleQuickFix(failure: tslint.RuleFailure, fileName: string, file: ts_module.SourceFile): ts_module.CodeFixAction {
        return {
            description: `Disable rule '${failure.getRuleName()}'`,
            fixName: '',
            changes: [{
                fileName,
                textChanges: [{
                    newText: `// tslint:disable-next-line: ${failure.getRuleName()}\n`,
                    span: { start: file.getLineStarts()[failure.getStartPosition().getLineAndCharacter().line], length: 0 },
                }],
            }],
        };
    }

    private getFixAllAutoFixableQuickFix(documentFixes: ProblemMap, fileName: string): ts_module.CodeFixAction {
        const allReplacements = getNonOverlappingReplacements(Array.from(documentFixes.values()).filter(x => x.fixable).map(x => x.failure));
        return {
            description: `Fix all auto-fixable tslint failures`,
            fixName: '',
            changes: [{
                fileName,
                textChanges: allReplacements.map(convertReplacementToTextChange),
            }],
        };
    }

    private getProgram() {
        return this.project.getLanguageService().getProgram()!;
    }

    private makeDiagnostic(failure: tslint.RuleFailure, file: ts.SourceFile): ts.Diagnostic {
        const message = (failure.getRuleName() !== null)
            ? `${failure.getFailure()} (${failure.getRuleName()})`
            : `${failure.getFailure()}`;

        const category = this.getDiagnosticCategory(failure);

        return {
            file,
            start: failure.getStartPosition().getPosition(),
            length: failure.getEndPosition().getPosition() - failure.getStartPosition().getPosition(),
            messageText: message,
            category,
            source: TSLINT_ERROR_SOURCE,
            code: TSLINT_ERROR_CODE,
        };
    }

    private getDiagnosticCategory(failure: tslint.RuleFailure): ts.DiagnosticCategory {
        if (this.configurationManager.config.alwaysShowRuleFailuresAsWarnings || typeof this.configurationManager.config.alwaysShowRuleFailuresAsWarnings === 'undefined') {
            return this.ts.DiagnosticCategory.Warning;
        }
        if (failure.getRuleSeverity && failure.getRuleSeverity() === 'error') {
            return this.ts.DiagnosticCategory.Error;
        }
        return this.ts.DiagnosticCategory.Warning;
    }
}

function convertReplacementToTextChange(repl: tslint.Replacement): ts_module.TextChange {
    return {
        newText: repl.text,
        span: { start: repl.start, length: repl.length },
    };
}

function failureToFileTextChange(failure: tslint.RuleFailure, fileName: string): ts_module.FileTextChanges {
    const fix = failure.getFix();
    const replacements: tslint.Replacement[] = getReplacements(fix);

    return {
        fileName,
        textChanges: replacements.map(convertReplacementToTextChange),
    };
}

function replacementsAreEmpty(fix: tslint.Fix | undefined): boolean {
    if (Array.isArray(fix)) {
        return fix.length === 0;
    }
    return false;
}
