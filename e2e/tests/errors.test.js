// @ts-check
const assert = require('chai').assert;
const path = require('path');
const createServer = require('../server-fixture');
const { openMockFile, getFirstResponseOfType, getResponsesOfType } = require('./helpers');

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
            `let t: Array<string> = new Array<string>();
let x: Array<string> = new Array<string>();

console.log(t, x);`);
        assert.isTrue(errorResponse.success);
        assert.strictEqual(errorResponse.body.length, 2);

        const [error1, error2] = errorResponse.body;
        assert.strictEqual(error1.source, 'tslint');
        
        assert.strictEqual(error2.source, 'tslint');
    });
});
