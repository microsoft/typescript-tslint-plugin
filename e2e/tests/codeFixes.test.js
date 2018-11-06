// @ts-check
const { assertSpan } = require('./assert');
const assert = require('chai').assert;
const path = require('path');
const createServer = require('../server-fixture');
const { openMockFile, getFirstResponseOfType } = require('./helpers');

const tslintSource = 'tslint';

const mockFileName = path.join(__dirname, '..', 'project-fixture', 'main.ts');

/**
 * @param {string} fileContents 
 * @param {{ startLine: number, startOffset: number, endLine: number, endOffset: number }} data
 */
const getCodeFixes = (fileContents, data) => {
    const server = createServer();
    openMockFile(server, mockFileName, fileContents);

    // Generate diagnostics 
    server.sendCommand('semanticDiagnosticsSync', { file: mockFileName });

    server.sendCommand('getCodeFixes', {
        file: mockFileName,
        startLine: data.startLine,
        startOffset: data.startOffset,
        endLine: data.endLine,
        endOffset: data.endOffset,
        errorCodes: [100000]
    });

    return server.close().then(_ => {
        return getFirstResponseOfType('getCodeFixes', server);
    });
}

describe('CodeFixes', () => {
    it('should return fix for array-type', async () => {
        const errorResponse = await getCodeFixes(
            `let t: Array<string> = new Array<string>(); console.log(t);`, {
                startLine: 1,
                startOffset: 8,
                endLine: 1,
                endOffset: 21,
            });

        assert.isTrue(errorResponse.success);
        assert.strictEqual(errorResponse.body.length, 3);

        const [firstFix] = errorResponse.body;
        {
            assert.strictEqual(firstFix.description, "Fix: Array type using 'Array<T>' is forbidden for simple types. Use 'T[]' instead.");

            const change = firstFix.changes[0];
            assert.strictEqual(change.textChanges.length, 2);

            assertSpan(change.textChanges[0], { "line": 1, "offset": 8 }, { "line": 1, "offset": 14 });
            assert.strictEqual(change.textChanges[0].newText, '');

            assertSpan(change.textChanges[1], { "line": 1, "offset": 20 }, { "line": 1, "offset": 21 });
            assert.strictEqual(change.textChanges[1].newText, '[]');
        }
    });
});
