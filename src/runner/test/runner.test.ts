import { expect } from 'chai';
import * as fs from 'fs';
import 'mocha';
import * as path from 'path';
import { RunConfiguration, TsLintRunner } from '../index';
import { getNonOverlappingReplacements, filterProblemsForFile } from '../failures';

const testDataRoot = path.join(__dirname, '..', '..', '..', 'test-data');

const defaultRunConfiguration: RunConfiguration = {
    exclude: [],
    jsEnable: false,
    ignoreDefinitionFiles: true,
};

describe('TSLintRunner', () => {
    describe('runTsLint', () => {
        // Must come first. TS lint only reports warnings once.
        it.skip('should report warnings', () => {
            const filePath = path.join(testDataRoot, 'no-unused-variables', 'test.ts');
            const result = createTsLintRunner().runTsLint(filePath, fs.readFileSync(filePath).toString(), defaultRunConfiguration);

            expect(result.lintResult.errorCount).to.equal(0);
            expect(result.warnings.length).to.equal(2);
        });

        it('should not return any errors for empty file', () => {
            const result = createTsLintRunner().runTsLint('', '', defaultRunConfiguration);
            expect(result.lintResult.errorCount).to.equal(0);
        });

        it('should return an error for test file', () => {
            const folderPath = path.join(testDataRoot, 'with-tslint');
            const filePath = path.join(folderPath, 'test.ts');
            const result = createTsLintRunner().runTsLint(filePath, fs.readFileSync(filePath).toString(), defaultRunConfiguration);

            expect(result.lintResult.errorCount).to.equal(1);
            expect(result.lintResult.warningCount).to.equal(0);

            const firstFailure = result.lintResult.failures[0];
            expect(path.normalize(firstFailure.getFileName())).to.equal(filePath);
            expect(firstFailure.getRuleName()).to.equal('array-type');

            const fix = firstFailure.getFix();
            expect(fix).to.not.equal(undefined);
            expect(fix!.length).to.equal(2);

            expect(result.configFilePath).to.equal(path.join(folderPath, 'tslint.json'));
        });

        it('should not validate using if no tslint.json exists and validateWithDefaultConfig is false', () => {
            const filePath = path.join(testDataRoot, 'no-tslint', 'test.ts');
            const result = createTsLintRunner().runTsLint(filePath, fs.readFileSync(filePath).toString(), {
                ...defaultRunConfiguration,
                validateWithDefaultConfig: false,
            });

            expect(result.lintResult.errorCount).to.equal(0);
            expect(result.lintResult.warningCount).to.equal(0);
        });

        it('should use correct config for each file', () => {
            const warningFilePath = path.join(testDataRoot, 'warnings', 'test.ts');
            const warnResult = createTsLintRunner().runTsLint(warningFilePath, fs.readFileSync(warningFilePath).toString(), defaultRunConfiguration);

            expect(warnResult.lintResult.errorCount).to.equal(0);
            expect(warnResult.lintResult.warningCount).to.equal(1);

            const errorFilePath = path.join(testDataRoot, 'with-tslint', 'test.ts');
            const errorResult = createTsLintRunner().runTsLint(errorFilePath, fs.readFileSync(warningFilePath).toString(), defaultRunConfiguration);

            expect(errorResult.lintResult.errorCount).to.equal(1);
            expect(errorResult.lintResult.warningCount).to.equal(0);
        });

        it('should not return any errors for excluded file (absolute path)', () => {
            const filePath = path.join(testDataRoot, 'with-tslint', 'test.ts');
            const result = createTsLintRunner().runTsLint(filePath, fs.readFileSync(filePath).toString(), {
                ...defaultRunConfiguration,
                exclude: [filePath],
            });

            expect(result.lintResult.errorCount).to.equal(0);
        });

        it('should not return any errors for excluded file (relative path)', () => {
            const root = path.join(testDataRoot, 'with-tslint');
            const filePath = path.join(root, 'test.ts');
            const result = createTsLintRunner().runTsLint(filePath, fs.readFileSync(filePath).toString(), {
                ...defaultRunConfiguration,
                workspaceFolderPath: root,
                exclude: ['test.ts'],
            });

            expect(result.lintResult.errorCount).to.equal(0);
        });

        it('should set working directory to workspace path', () => {
            const workspacePath = path.join(testDataRoot, 'with-tslint');
            const filePath = path.join(workspacePath, 'test.ts');
            const result = createTsLintRunner().runTsLint(filePath, fs.readFileSync(filePath).toString(), {
                ...defaultRunConfiguration,
                workspaceFolderPath: workspacePath,
            });

            expect(result.lintResult.errorCount).to.equal(1);
            expect(result.lintResult.warningCount).to.equal(0);
            expect(result.workspaceFolderPath).to.equal(workspacePath);
        });

        it.skip('should return warnings for invalid tslint install', () => {
            const root = path.join(testDataRoot, 'invalid-install');
            const filePath = path.join(root, 'test.ts');
            const result = createTsLintRunner().runTsLint(filePath, fs.readFileSync(filePath).toString(), {
                ...defaultRunConfiguration,
                workspaceFolderPath: root,
            });

            expect(result.warnings.length).to.equal(1);
        });

        it('should not return errors in js file by default', () => {
            const root = path.join(testDataRoot, 'with-tslint');
            const filePath = path.join(root, 'test.js');
            const result = createTsLintRunner().runTsLint(filePath, fs.readFileSync(filePath).toString(), defaultRunConfiguration);

            expect(result.lintResult.errorCount).to.equal(0);
        });

        it('should return errors in js file if jsEnable is set', () => {
            const root = path.join(testDataRoot, 'with-tslint');
            const filePath = path.join(root, 'test.js');
            const result = createTsLintRunner().runTsLint(filePath, fs.readFileSync(filePath).toString(), { ...defaultRunConfiguration, jsEnable: true });

            expect(result.lintResult.errorCount).to.equal(1);
        });

        it('should not return errors in excluded file', () => {
            const root = path.join(testDataRoot, 'with-tslint');
            const filePath = path.join(root, 'excluded.ts');
            const result = createTsLintRunner().runTsLint(filePath, fs.readFileSync(filePath).toString(), defaultRunConfiguration);

            expect(result.lintResult.errorCount).to.equal(0);
        });

        it('should generate warning for invalid node path', () => {
            const root = path.join(testDataRoot, 'with-tslint');
            const filePath = path.join(root, 'test.ts');
            const result = createTsLintRunner().runTsLint(filePath, fs.readFileSync(filePath).toString(), {
                ...defaultRunConfiguration,
                nodePath: 'invalid',
            });

            expect(result.lintResult.errorCount).to.equal(1);
            expect(result.warnings.length).to.equal(1);
        });

        it('should ignore no-unused-varaible rule', () => {
            const root = path.join(testDataRoot, 'with-tslint');
            const filePath = path.join(root, 'unused-variable.ts');
            const result = createTsLintRunner().runTsLint(filePath, fs.readFileSync(filePath).toString(), defaultRunConfiguration);

            expect(result.lintResult.errorCount).to.equal(0);
            expect(result.warnings.length).to.equal(0);
        });

        it('should not return errors in js files by default', () => {
            const root = path.join(testDataRoot, 'js-disabled');
            {
                const filePath = path.join(root, 'test.mjs');
                const result = createTsLintRunner().runTsLint(filePath, fs.readFileSync(filePath).toString(), defaultRunConfiguration);
                expect(result.lintResult.errorCount).to.equal(0);
            }
            {
                const filePath = path.join(root, 'test.mjs');
                const result = createTsLintRunner().runTsLint(filePath, fs.readFileSync(filePath).toString(), defaultRunConfiguration);
                expect(result.lintResult.errorCount).to.equal(0);
            }
        });

        it('should support using a tslint.js config file', () => {
            const root = path.join(testDataRoot, 'with-tslint-js-config-file');

            const filePath = path.join(root, 'test.ts');
            const result = createTsLintRunner().runTsLint(filePath, fs.readFileSync(filePath).toString(), {
                configFile: path.join(root, 'tslint.js'),
                ...defaultRunConfiguration
            });
            expect(result.lintResult.errorCount).to.equal(2);
            expect(result.lintResult.failures[0].getRuleName()).to.equal('array-type');
            expect(result.lintResult.failures[1].getRuleName()).to.equal('quotemark');
        });
    });

    describe('filterProblemsForFile', () => {
        it('should filter out all problems not in file', () => {
            const runner = createTsLintRunner();
            const filePath = path.join(testDataRoot, 'with-tslint', 'test.ts');
            const result = runner.runTsLint(filePath, fs.readFileSync(filePath).toString(), defaultRunConfiguration);

            expect(result.lintResult.failures.length).to.equal(1);

            const filteredFailures = filterProblemsForFile('does-not-exist', result.lintResult.failures);
            expect(filteredFailures.length).to.equal(0);
        });
    });

    describe('getNonOverlappingReplacements', () => {
        it('should filter out overlapping replacements', () => {
            const runner = createTsLintRunner();
            const filePath = path.join(testDataRoot, 'overlapping-errors', 'test.ts');
            const result = runner.runTsLint(filePath, fs.readFileSync(filePath).toString(), defaultRunConfiguration);

            expect(result.lintResult.failures.length).to.equal(2);

            const noOverlappingReplacements = getNonOverlappingReplacements(result.lintResult.failures);
            expect(noOverlappingReplacements.length).to.equal(1);
        });
    });
});

function createTsLintRunner() {
    return new TsLintRunner((_value: string) => { /* noop */ });
}
