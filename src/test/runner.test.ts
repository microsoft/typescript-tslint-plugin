import { expect } from 'chai';
import * as fs from 'fs';
import 'mocha';
import * as path from 'path';
import { RunConfiguration, TsLintRunner } from '../runner';

const testDataRoot = path.join(__dirname, '..', '..', 'test-data');

describe('TSLintRunner', () => {
    describe('runTsLint', () => {
        // Must come first. TS lint only reports warnings once.
        it.skip('should report warnings', () => {
            const filePath = path.join(testDataRoot, 'no-unused-variables', 'test.ts');
            const result = createTsLintRunner().runTsLint(filePath, fs.readFileSync(filePath).toString(), {} as RunConfiguration);

            expect(result.lintResult.errorCount).to.equal(0);
            expect(result.warnings.length).to.equal(2);
        });

        it('should not return any errors for empty file', () => {
            const result = createTsLintRunner().runTsLint('', '', {} as RunConfiguration);
            expect(result.lintResult.errorCount).to.equal(0);
        });

        it('should return an error for test file', () => {
            const folderPath = path.join(testDataRoot, 'with-tslint')
            const filePath = path.join(folderPath, 'test.ts');
            const result = createTsLintRunner().runTsLint(filePath, fs.readFileSync(filePath).toString(), {} as RunConfiguration);

            expect(result.lintResult.errorCount).to.equal(1);
            expect(result.lintResult.warningCount).to.equal(0);

            const firstFailure = result.lintResult.failures[0];
            expect(firstFailure.getFileName()).to.equal(filePath);
            expect(firstFailure.getRuleName()).to.equal('array-type');

            const fix = firstFailure.getFix();
            expect(fix).to.not.equal(undefined);
            expect(fix!.length).to.equal(2);

            expect(result.configFilePath).to.equal(path.join(folderPath, 'tslint.json'));
        });

        it('should not validate using if no tslint.json exists and validateWithDefaultConfig is false', () => {
            const filePath = path.join(testDataRoot, 'no-tslint', 'test.ts');
            const result = createTsLintRunner().runTsLint(filePath, fs.readFileSync(filePath).toString(), {
                validateWithDefaultConfig: false,
            } as RunConfiguration);

            expect(result.lintResult.errorCount).to.equal(0);
            expect(result.lintResult.warningCount).to.equal(0);
        });

        it('should use correct config for each file', () => {
            const warningFilePath = path.join(testDataRoot, 'warnings', 'test.ts');
            const warnResult = createTsLintRunner().runTsLint(warningFilePath, fs.readFileSync(warningFilePath).toString(), {} as RunConfiguration);

            expect(warnResult.lintResult.errorCount).to.equal(0);
            expect(warnResult.lintResult.warningCount).to.equal(1);

            const errorFilePath = path.join(testDataRoot, 'with-tslint', 'test.ts');
            const errorResult = createTsLintRunner().runTsLint(errorFilePath, fs.readFileSync(warningFilePath).toString(), {} as RunConfiguration);

            expect(errorResult.lintResult.errorCount).to.equal(1);
            expect(errorResult.lintResult.warningCount).to.equal(0);
        });

        it('should not return any errors for excluded file', () => {
            const filePath = path.join(testDataRoot, 'with-tslint', 'test.ts');
            const result = createTsLintRunner().runTsLint(filePath, fs.readFileSync(filePath).toString(), {
                exclude: [filePath],
            } as RunConfiguration);

            expect(result.lintResult.errorCount).to.equal(0);
        });

        it('should set working directory to workspace path', () => {
            const workspacePath = path.join(testDataRoot, 'with-tslint');
            const filePath = path.join(workspacePath, 'test.ts');
            const result = createTsLintRunner().runTsLint(filePath, fs.readFileSync(filePath).toString(), {
                workspaceFolderPath: workspacePath,
            } as RunConfiguration);

            expect(result.lintResult.errorCount).to.equal(1);
            expect(result.lintResult.warningCount).to.equal(0);
            expect(result.workspaceFolderPath).to.equal(workspacePath);
        });

        it.skip('should return warnings for invalid tslint install', () => {
            const root = path.join(testDataRoot, 'invalid-install');
            const filePath = path.join(root, 'test.ts');
            const result = createTsLintRunner().runTsLint(filePath, fs.readFileSync(filePath).toString(), {
                workspaceFolderPath: root,
            } as RunConfiguration);

            expect(result.warnings.length).to.equal(1);
        });

        it('should not return errors in js file by default', () => {
            const root = path.join(testDataRoot, 'with-tslint');
            const filePath = path.join(root, 'test.js');
            const result = createTsLintRunner().runTsLint(filePath, fs.readFileSync(filePath).toString(), {} as RunConfiguration);

            expect(result.lintResult.errorCount).to.equal(0);
        });

        it('should return errors in js file if jsEnable is set', () => {
            const root = path.join(testDataRoot, 'with-tslint');
            const filePath = path.join(root, 'test.js');
            const result = createTsLintRunner().runTsLint(filePath, fs.readFileSync(filePath).toString(), { jsEnable: true } as RunConfiguration);

            expect(result.lintResult.errorCount).to.equal(1);
        });

        it('should not return errors in excluded file', () => {
            const root = path.join(testDataRoot, 'with-tslint');
            const filePath = path.join(root, 'excluded.ts');
            const result = createTsLintRunner().runTsLint(filePath, fs.readFileSync(filePath).toString(), {} as RunConfiguration);

            expect(result.lintResult.errorCount).to.equal(0);
        });

        it('should generate warning for invalid node path', () => {
            const root = path.join(testDataRoot, 'with-tslint');
            const filePath = path.join(root, 'test.ts');
            const result = createTsLintRunner().runTsLint(filePath, fs.readFileSync(filePath).toString(), {
                nodePath: 'invalid',
            } as RunConfiguration);

            expect(result.lintResult.errorCount).to.equal(1);
            expect(result.warnings.length).to.equal(1);
        });

        it('should ignore no-unused-varaible rule', () => {
            const root = path.join(testDataRoot, 'with-tslint');
            const filePath = path.join(root, 'unused-variable.ts');
            const result = createTsLintRunner().runTsLint(filePath, fs.readFileSync(filePath).toString(), { } as RunConfiguration);

            expect(result.lintResult.errorCount).to.equal(0);
            expect(result.warnings.length).to.equal(0);
        });
    });

    describe('filterProblemsForFile', () => {
        it('should filter out all problems not in file', () => {
            const runner = createTsLintRunner();
            const filePath = path.join(testDataRoot, 'with-tslint', 'test.ts');
            const result = runner.runTsLint(filePath, fs.readFileSync(filePath).toString(), {} as RunConfiguration);

            expect(result.lintResult.failures.length).to.equal(1);

            const filteredFailures = runner.filterProblemsForFile('does-not-exist', result.lintResult.failures);
            expect(filteredFailures.length).to.equal(0);
        });
    });

    describe('getNonOverlappingReplacements', () => {
        it('should filter out overlapping replacements', () => { 
            const runner = createTsLintRunner();
            const filePath = path.join(testDataRoot, 'overlapping-errors', 'test.ts');
            const result = runner.runTsLint(filePath, fs.readFileSync(filePath).toString(), {} as RunConfiguration);

            expect(result.lintResult.failures.length).to.equal(2);

            const noOverlappingReplacements = runner.getNonOverlappingReplacements(result.lintResult.failures);
            expect(noOverlappingReplacements.length).to.equal(1);
        });
    });
});

function createTsLintRunner() {
    return new TsLintRunner((_value: string) => { /* noop */ });
}
