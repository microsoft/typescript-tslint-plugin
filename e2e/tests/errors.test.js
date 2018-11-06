// @ts-check
const { assertSpan } = require('./assert');
const assert = require('chai').assert;
const path = require('path');
const createServer = require('../server-fixture');
const { openMockFile, getFirstResponseOfType } = require('./helpers');

const tslintSource = 'tslint';

const mockFileName = path.join(__dirname, '..', 'project-fixture', 'main.ts');

const getSemanticDiagnosticsForFile = (fileContents) => {
    const server = createServer();
    openMockFile(server, mockFileName, fileContents);
    server.sendCommand('semanticDiagnosticsSync', { file: mockFileName });

    return server.close().then(_ => {
        return getFirstResponseOfType('semanticDiagnosticsSync', server);
    });
}

describe('Errors', () => {
    it('array-type', async () => {
        const errorResponse = await getSemanticDiagnosticsForFile(
            `let t: Array<string> = new Array<string>(); console.log(t);`);

        assert.isTrue(errorResponse.success);
        assert.strictEqual(errorResponse.body.length, 1);

        const [error1] = errorResponse.body;
        assert.strictEqual(error1.source, tslintSource);
        assertSpan(error1, { line: 1, offset: 8 }, { line: 1, offset: 21 });
        assert.strictEqual(error1.text, `Array type using 'Array<T>' is forbidden for simple types. Use 'T[]' instead. (array-type)`);
    });

    it('arrow-parens', async () => {
        const errorResponse = await getSemanticDiagnosticsForFile(
            `[1, 2 ].map( num => console.log(num) );`);

        assert.isTrue(errorResponse.success);
        assert.strictEqual(errorResponse.body.length, 1);

        const [error1] = errorResponse.body;
        assert.strictEqual(error1.source, tslintSource);
        assertSpan(error1, { line: 1, offset: 14 }, { line: 1, offset: 17 });
        assert.strictEqual(error1.text, `Parentheses are required around the parameters of an arrow function definition (arrow-parens)`);
    });
});
