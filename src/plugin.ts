import * as tslint from 'tslint';
import * as path from 'path';
import * as ts_module from 'typescript/lib/tsserverlibrary';
import { TSLINT_ERROR_CODE, TSLINT_ERROR_SOURCE } from './config';
import { ConfigFileWatcher } from './configFileWatcher';
import { Logger } from './logger';
import { RunResult, TsLintRunner, toPackageManager, WorkspaceLibraryExecution } from './runner';
import { ConfigurationManager } from './settings';
import { getNonOverlappingReplacements, filterProblemsForFile, getReplacements } from './runner/failures';

const isTsLintLanguageServiceMarker = Symbol('__isTsLintLanguageServiceMarker__');

interface Problem {
    failure: tslint.RuleFailure;
    fixable: boolean;
}

class TsLintFixId {
    public static fromFailure(failure: tslint.RuleFailure) {
        return `tslint:${failure.getRuleName()}`;
    }

    public static toRuleName(fixId: {}): undefined | string {
        if (typeof fixId !== 'string' || !fixId.startsWith('tslint:')) {
            return undefined;
        }
        return fixId.replace(/^tslint:/, '');
    }
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

    private runner: TsLintRunner;

    private workspaceTrust = WorkspaceLibraryExecution.Unknown;

    public constructor(
        private readonly ts: typeof ts_module,
        private readonly languageServiceHost: ts_module.LanguageServiceHost,
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
                ...oldGetSupportedCodeFixes(),
                '' + TSLINT_ERROR_CODE,
            ];
        };

        const intercept: Partial<ts.LanguageService> = Object.create(null);

        const oldGetSemanticDiagnostics = languageService.getSemanticDiagnostics.bind(languageService);
        intercept.getSemanticDiagnostics = (...args) => {
            return this.getSemanticDiagnostics(oldGetSemanticDiagnostics, ...args);
        };

        const oldGetCodeFixesAtPosition = languageService.getCodeFixesAtPosition.bind(languageService);
        intercept.getCodeFixesAtPosition = (...args): ReadonlyArray<ts.CodeFixAction> => {
            return this.getCodeFixesAtPosition(oldGetCodeFixesAtPosition, ...args);
        };

        const oldGetCombinedCodeFix = languageService.getCombinedCodeFix.bind(languageService);
        intercept.getCombinedCodeFix = (...args): ts_module.CombinedCodeActions => {
            return this.getCombinedCodeFix(oldGetCombinedCodeFix, ...args);
        };

        return new Proxy(languageService, {
            get: (target: any, property: keyof ts.LanguageService & typeof isTsLintLanguageServiceMarker) => {
                if (property === isTsLintLanguageServiceMarker) {
                    return true;
                }
                return intercept[property] || target[property];
            },
        });
    }

    public updateWorkspaceTrust(workspaceTrust: WorkspaceLibraryExecution) {
        this.workspaceTrust = workspaceTrust;

        // Reset the runner
        this.runner = new TsLintRunner(message => { this.logger.info(message); });
    }

    private getSemanticDiagnostics(
        delegate: (fileName: string) => ts_module.Diagnostic[],
        fileName: string,
    ): ts_module.Diagnostic[] {
        const diagnostics = delegate(fileName);

        if (isInMemoryFile(fileName)) {
            // In-memory file. TS-lint crashes on these so ignore them
            return diagnostics;
        }

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
                    exclude: config.exclude
                        ? Array.isArray(config.exclude) ? config.exclude : [config.exclude]
                        : [],
                    packageManager: toPackageManager(config.packageManager),
                    workspaceLibraryExecution: this.workspaceTrust,
                });
                if (result.configFilePath) {
                    this.configFileWatcher.ensureWatching(result.configFilePath);
                }
            } catch (err: any) {
                let errorMessage = `unknown error`;
                if (typeof err.message === 'string' || err.message instanceof String) {
                    errorMessage = err.message as string;
                }
                this.logger.info('tslint error ' + errorMessage);
                return diagnostics;
            }

            const program = this.getProgram();
            const file = program.getSourceFile(fileName)!;
            if (result.warnings) {
                const defaultTsconfigJsonPath = path.join(program.getCurrentDirectory(), 'tslint.json');
                if ((result.configFilePath && this.ts.sys.fileExists(result.configFilePath)) || this.ts.sys.fileExists(defaultTsconfigJsonPath)) {
                    // If we have a config file, the user likely wanted to lint. The fact that linting has a
                    // warning should be reported to them.
                    for (const warning of result.warnings) {
                        diagnostics.unshift({
                            file,
                            start: 0,
                            length: 1,
                            category: this.ts.DiagnosticCategory.Warning,
                            source: TSLINT_ERROR_SOURCE,
                            code: TSLINT_ERROR_CODE,
                            messageText: warning,
                        });
                    }
                } else {
                    // If we have not found a config file, then we don't want to annoy users by generating warnings
                    // about tslint not being installed or misconfigured. In many cases, the user is opening a
                    // file/project that was not intended to be linted.
                    for (const warning of result.warnings) {
                        this.logger.info(`[tslint] ${warning}`);
                    }
                }
            }

            const tslintProblems = filterProblemsForFile(fileName, result.lintResult.failures);
            for (const problem of tslintProblems) {
                diagnostics.push(this.makeDiagnostic(problem, file));
                this.recordCodeAction(problem, file);
            }
        } catch (e: any) {
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
        errorCodes: ReadonlyArray<number>,
        formatOptions: ts.FormatCodeSettings,
        userPreferences: ts.UserPreferences
    ): ReadonlyArray<ts.CodeFixAction> {
        const fixes = Array.from(delegate(fileName, start, end, errorCodes, formatOptions, userPreferences));

        if (isInMemoryFile(fileName)) {
            return fixes; // We don't have any tslint errors for these files
        }

        if (this.configurationManager.config.suppressWhileTypeErrorsPresent && fixes.length > 0) {
            return fixes;
        }

        this.logger.info(`getCodeFixes ${errorCodes[0]}`);
        this.logger.info(JSON.stringify(fixes));

        const documentFixes = this.codeFixActions.get(fileName);
        if (documentFixes) {
            const problem = documentFixes.get(start, end);
            if (problem) {
                if (problem.fixable) {
                    const fix = problem.failure.getFix();
                    if (fix) {
                        const codeFixAction = this.getRuleFailureQuickFix(problem.failure, fileName);
                        fixes.push(codeFixAction);

                        const fixAll = this.getRuleFailureFixAllQuickFix(problem.failure.getRuleName(), documentFixes, fileName);
                        if (fixAll) {
                            codeFixAction.fixId = TsLintFixId.fromFailure(problem.failure);
                            codeFixAction.fixAllDescription = `Fix all '${problem.failure.getRuleName()}'`;
                        }

                        fixes.push(this.getFixAllAutoFixableQuickFix(documentFixes, fileName));
                    }
                }

                fixes.push(this.getDisableRuleQuickFix(problem.failure, fileName, this.getProgram().getSourceFile(fileName)!));
            }
        }

        return fixes;
    }

    private getCombinedCodeFix(
        delegate: ts.LanguageService['getCombinedCodeFix'],
        scope: ts_module.CombinedCodeFixScope,
        fixId: {},
        formatOptions: ts_module.FormatCodeSettings,
        preferences: ts_module.UserPreferences
    ): ts_module.CombinedCodeActions {
        const ruleName = TsLintFixId.toRuleName(fixId);
        if (!ruleName) {
            return delegate(scope, fixId, formatOptions, preferences);
        }

        const documentFixes = this.codeFixActions.get(scope.fileName);
        if (documentFixes) {
            const fixAll = this.getRuleFailureFixAllQuickFix(ruleName, documentFixes, scope.fileName);
            if (fixAll) {
                return {
                    changes: fixAll.changes,
                    commands: fixAll.commands,
                };
            }
        }

        return { changes: [] };
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
            fixName: `tslint:${failure.getRuleName()}`,
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
            fixName: `tslint:fix-all:${ruleName}`,
            changes,
        };
    }

    private getDisableRuleQuickFix(failure: tslint.RuleFailure, fileName: string, file: ts_module.SourceFile): ts_module.CodeFixAction {
        const line = failure.getStartPosition().getLineAndCharacter().line;
        const lineStarts = file.getLineStarts();
        const lineStart = lineStarts[line];
        let prefix = '';
        const snapshot = this.languageServiceHost.getScriptSnapshot(fileName);
        if (snapshot) {
            const lineEnd = line < lineStarts.length - 1 ? lineStarts[line + 1] : file.end;
            const lineText = snapshot.getText(lineStart, lineEnd);
            const leadingSpace = lineText.match(/^([ \t]+)/);
            if (leadingSpace) {
                prefix = leadingSpace[0];
            }
        }

        return {
            description: `Disable rule '${failure.getRuleName()}'`,
            fixName: `tslint:disable:${failure.getRuleName()}`,
            changes: [{
                fileName,
                textChanges: [{
                    newText: `${prefix}// tslint:disable-next-line: ${failure.getRuleName()}\n`,
                    span: { start: lineStart, length: 0 },
                }],
            }],
        };
    }

    private getFixAllAutoFixableQuickFix(documentFixes: ProblemMap, fileName: string): ts_module.CodeFixAction {
        const allReplacements = getNonOverlappingReplacements(Array.from(documentFixes.values()).filter(x => x.fixable).map(x => x.failure));
        return {
            description: `Fix all auto-fixable tslint failures`,
            fixName: `tslint:fix-all`,
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

function isInMemoryFile(fileName: string) {
    return fileName.startsWith('^');
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
