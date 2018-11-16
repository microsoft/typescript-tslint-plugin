import * as tslint from 'tslint';
import * as ts_module from 'typescript/lib/tsserverlibrary';
import { TSLINT_ERROR_CODE, TSLINT_ERROR_SOURCE } from './config';
import { ConfigFileWatcher } from './configFileWatcher';
import { Logger } from './logger';
import { RunResult, TsLintRunner } from './runner';
import { ConfigurationManager } from './settings';
import { getNonOverlappingReplacements, filterProblemsForFile } from './runner/failures';

class FailureMap {
    private readonly _map = new Map<string, tslint.RuleFailure>();

    public get(start: number, end: number) {
        return this._map.get(this.key(start, end));
    }

    public set(start: number, end: number, failure: tslint.RuleFailure): void {
        this._map.set(this.key(start, end), failure);
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
    private readonly codeFixActions = new Map<string, FailureMap>();
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
        const oldGetSupportedCodeFixes = this.ts.getSupportedCodeFixes.bind(this.ts);
        this.ts.getSupportedCodeFixes = (): string[] => {
            return [
                ...oldGetSupportedCodeFixes(),
                '' + TSLINT_ERROR_CODE,
            ];
        };

        const oldGetSemanticDiagnostics = languageService.getSemanticDiagnostics.bind(languageService);
        languageService.getSemanticDiagnostics = (fileName: string) => {
            return this.getSemanticDiagnostics(oldGetSemanticDiagnostics, fileName);
        };

        const getCodeFixesAtPosition = languageService.getCodeFixesAtPosition.bind(languageService);
        languageService.getCodeFixesAtPosition = (fileName: string, start: number, end: number, errorCodes: number[], formatOptions: ts.FormatCodeSettings, userPreferences: ts.UserPreferences): ReadonlyArray<ts.CodeFixAction> => {
            return this.getCodeFixesAtPosition(getCodeFixesAtPosition, fileName, start, end, errorCodes, formatOptions, userPreferences);
        };

        return languageService;
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

            if (config.ignoreDefinitionFiles === true && fileName.endsWith('.d.ts')) {
                return diagnostics;
            }

            let result: RunResult;
            try { // protect against tslint crashes
                result = this.runner.runTsLint(fileName, this.getProgram(), {
                    configFile: config.configFile,
                    ignoreDefinitionFiles: config.ignoreDefinitionFiles,
                    jsEnable: config.jsEnable,
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
                diagnostics.push({
                    code: TSLINT_ERROR_CODE,
                    source: TSLINT_ERROR_SOURCE,
                    category: this.ts.DiagnosticCategory.Error,
                    file,
                    start: 0,
                    length: 1,
                    messageText: warning,
                });
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
            if (problem) {
                const fix = problem.getFix();
                if (fix) {
                    fixes.push(this.getRuleFailureQuickFix(problem, fileName));

                    const fixAll = this.getRuleFailureFixAllQuickFix(problem.getRuleName(), documentFixes, fileName);
                    if (fixAll) {
                        fixes.push(fixAll);
                    }
                }
            }

            fixes.push(this.getFixAllAutoFixableQuickFix(documentFixes, fileName));

            if (problem) {
                fixes.push(this.getDisableRuleQuickFix(problem, fileName, this.getProgram().getSourceFile(fileName)!));
            }
        }

        return fixes;
    }

    private recordCodeAction(problem: tslint.RuleFailure, file: ts.SourceFile) {
        let fix: tslint.Fix | undefined;

        // tslint can return a fix with an empty replacements array, these fixes are ignored
        if (problem.getFix && problem.getFix() && !replacementsAreEmpty(problem.getFix())) { // tslint fixes are not available in tslint < 3.17
            fix = problem.getFix(); // createAutoFix(problem, document, problem.getFix());
        }

        if (!fix) {
            return;
        }

        let documentAutoFixes = this.codeFixActions.get(file.fileName);
        if (!documentAutoFixes) {
            documentAutoFixes = new FailureMap();
            this.codeFixActions.set(file.fileName, documentAutoFixes);
        }
        documentAutoFixes.set(problem.getStartPosition().getPosition(), problem.getEndPosition().getPosition(), problem);
    }

    private getRuleFailureQuickFix(problem: tslint.RuleFailure, fileName: string): ts_module.CodeFixAction {
        return {
            description: `Fix: ${problem.getFailure()}`,
            fixName: '',
            changes: [problemToFileTextChange(problem, fileName)],
        };
    }

    /**
     * Generate a code action that fixes all instances of ruleName.
     */
    private getRuleFailureFixAllQuickFix(ruleName: string, problems: FailureMap, fileName: string): ts_module.CodeFixAction | undefined {
        const changes: ts_module.FileTextChanges[] = [];

        for (const problem of problems.values()) {
            if (problem.getRuleName() === ruleName) {
                changes.push(problemToFileTextChange(problem, fileName));
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

    private getDisableRuleQuickFix(problem: tslint.RuleFailure, fileName: string, file: ts_module.SourceFile): ts_module.CodeFixAction {
        return {
            description: `Disable rule '${problem.getRuleName()}'`,
            fixName: '',
            changes: [{
                fileName,
                textChanges: [{
                    newText: `// tslint:disable-next-line: ${problem.getRuleName()}\n`,
                    span: { start: file.getLineStarts()[problem.getStartPosition().getLineAndCharacter().line], length: 0 },
                }],
            }],
        };
    }

    private getFixAllAutoFixableQuickFix(documentFixes: FailureMap, fileName: string): ts_module.CodeFixAction {
        const allReplacements = getNonOverlappingReplacements(Array.from(documentFixes.values()));
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

    private makeDiagnostic(problem: tslint.RuleFailure, file: ts.SourceFile): ts.Diagnostic {
        const message = (problem.getRuleName() !== null)
            ? `${problem.getFailure()} (${problem.getRuleName()})`
            : `${problem.getFailure()}`;

        const category = this.getDiagnosticCategory(problem);

        return {
            file,
            start: problem.getStartPosition().getPosition(),
            length: problem.getEndPosition().getPosition() - problem.getStartPosition().getPosition(),
            messageText: message,
            category,
            source: TSLINT_ERROR_SOURCE,
            code: TSLINT_ERROR_CODE,
        };
    }

    private getDiagnosticCategory(problem: tslint.RuleFailure): ts.DiagnosticCategory {
        if (this.configurationManager.config.alwaysShowRuleFailuresAsWarnings === true) {
            return this.ts.DiagnosticCategory.Warning;
        } else if (problem.getRuleSeverity && problem.getRuleSeverity() === 'error') {
            // tslint5 supports to assign severities to rules
            return this.ts.DiagnosticCategory.Error;
        }
        return this.ts.DiagnosticCategory.Warning;
    }
}

function getReplacements(fix: tslint.Fix | undefined): tslint.Replacement[] {
    let replacements: tslint.Replacement[] | null = null;
    // in tslint4 a Fix has a replacement property with the Replacements
    if ((fix as any).replacements) {
        // tslint4
        replacements = (fix as any).replacements;
    } else {
        // in tslint 5 a Fix is a Replacement | Replacement[]
        if (!Array.isArray(fix)) {
            replacements = [fix as any];
        } else {
            replacements = fix;
        }
    }
    return replacements || [];
}

function convertReplacementToTextChange(repl: tslint.Replacement): ts_module.TextChange {
    return {
        newText: repl.text,
        span: { start: repl.start, length: repl.length },
    };
}

function problemToFileTextChange(problem: tslint.RuleFailure, fileName: string): ts_module.FileTextChanges {
    const fix = problem.getFix();
    const replacements: tslint.Replacement[] = getReplacements(fix);

    return {
        fileName,
        textChanges: replacements.map(convertReplacementToTextChange),
    };
}

function replacementsAreEmpty(fix: tslint.Fix | undefined): boolean {
    // in tslint 4 a Fix has a replacement property witht the Replacements
    if ((fix as any).replacements) {
        return (fix as any).replacements.length === 0;
    }
    // tslint 5
    if (Array.isArray(fix)) {
        return fix.length === 0;
    }
    return false;
}
