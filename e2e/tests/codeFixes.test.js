// @ts-check
const { assertSpan } = require('./assert');
const assert = require('chai').assert;
const path = require('path');
const createServer = require('../server-fixture');
const { openMockFile, getFirstResponseOfType } = require('./helpers');


const mockFileName = path.join(__dirname, '..', 'project-fixture', 'main.ts').replace(/\\/g, '/');

/**
 * @param {string[]} fileContents 
 */
function createServerForFile(...fileContents) {
    const server = createServer();
    openMockFile(server, mockFileName, fileContents.join('\n'));
    return server;
}

/**
 * @param {*} server 
 * @param {{ startLine: number, startOffset: number, endLine: number, endOffset: number, additionalErrorCodes?: number[] }} data
 */
const getCodeFixes = async (server, data) => {

    // Generate diagnostics 
    server.sendCommand('semanticDiagnosticsSync', { file: mockFileName });

    return server.sendCommand('getCodeFixes', {
        file: mockFileName,
        startLine: data.startLine,
        startOffset: data.startOffset,
        endLine: data.endLine,
        endOffset: data.endOffset,
        errorCodes: [1, ...(data.additionalErrorCodes || [])]
    });
};

const getCombinedCodeFixes = (server, fixId) => {
    return server.sendCommand('getCombinedCodeFix', {
        scope: {
            type: 'file',
            args: { file: mockFileName }
        },
        fixId: fixId,
    });
};

describe('CodeFixes', () => {
    let server = undefined;

    after(() => {
        if (server) {
            server.close();
            server = undefined;
        }
    })

    it('should return fix and disables for single error', async () => {
        server = createServerForFile(
            `let t: Array<string> = new Array<string>(); console.log(t);`
        );
        await getCodeFixes(server, {
            startLine: 1,
            startOffset: 8,
            endLine: 1,
            endOffset: 21,
        });
        await server.close();
        const codeFixesResponse = await getFirstResponseOfType('getCodeFixes', server);

        assert.isTrue(codeFixesResponse.success);
        assert.deepEqual(codeFixesResponse.body, [
            {
                "fixName": "tslint:array-type",
                "description": "Fix: Array type using 'Array<T>' is forbidden for simple types. Use 'T[]' instead.",
                "changes": [
                    {
                        "fileName": mockFileName,
                        "textChanges": [
                            {
                                "start": {
                                    "line": 1,
                                    "offset": 8
                                },
                                "end": {
                                    "line": 1,
                                    "offset": 14
                                },
                                "newText": ""
                            },
                            {
                                "start": {
                                    "line": 1,
                                    "offset": 20
                                },
                                "end": {
                                    "line": 1,
                                    "offset": 21
                                },
                                "newText": "[]"
                            }
                        ]
                    }
                ]
            },
            {
                "fixName": "tslint:fix-all",
                "description": "Fix all auto-fixable tslint failures",
                "changes": [
                    {
                        "fileName": mockFileName,
                        "textChanges": [
                            {
                                "start": {
                                    "line": 1,
                                    "offset": 8
                                },
                                "end": {
                                    "line": 1,
                                    "offset": 14
                                },
                                "newText": ""
                            },
                            {
                                "start": {
                                    "line": 1,
                                    "offset": 20
                                },
                                "end": {
                                    "line": 1,
                                    "offset": 21
                                },
                                "newText": "[]"
                            }
                        ]
                    }
                ]
            },
            {
                "fixName": "tslint:disable:array-type",
                "description": "Disable rule 'array-type'",
                "changes": [
                    {
                        "fileName": mockFileName,
                        "textChanges": [
                            {
                                "start": {
                                    "line": 1,
                                    "offset": 1
                                },
                                "end": {
                                    "line": 1,
                                    "offset": 1
                                },
                                "newText": "// tslint:disable-next-line: array-type\n"
                            }
                        ]
                    }
                ]
            }
        ]);
    });

    it('should return individual fixes and fix all for multiple errors of same type in file', async () => {
        server = createServerForFile(
            `let x: Array<string> = new Array<string>(); console.log(x);\nlet y: Array<string> = new Array<string>(); console.log(y);`,
        );
        await getCodeFixes(server, {
            startLine: 1,
            startOffset: 8,
            endLine: 1,
            endOffset: 21,
        });
        await getCombinedCodeFixes(server, 'tslint:array-type');

        await server.close();

        const codeFixesResponse = await getFirstResponseOfType('getCodeFixes', server);
        const combinedFixesResponse = await getFirstResponseOfType('getCombinedCodeFix', server);

        assert.isTrue(codeFixesResponse.success);
        assert.strictEqual(codeFixesResponse.body.length, 3);

        assert.deepEqual(codeFixesResponse.body, [
            {
                "fixName": "tslint:array-type",
                "description": "Fix: Array type using 'Array<T>' is forbidden for simple types. Use 'T[]' instead.",
                "fixAllDescription": "Fix all 'array-type'",
                "fixId": "tslint:array-type",
                "changes": [
                    {
                        "fileName": mockFileName,
                        "textChanges": [
                            {
                                "start": {
                                    "line": 1,
                                    "offset": 8
                                },
                                "end": {
                                    "line": 1,
                                    "offset": 14
                                },
                                "newText": ""
                            },
                            {
                                "start": {
                                    "line": 1,
                                    "offset": 20
                                },
                                "end": {
                                    "line": 1,
                                    "offset": 21
                                },
                                "newText": "[]"
                            }
                        ]
                    }
                ]
            },
            {
                "fixName": "tslint:fix-all",
                "description": "Fix all auto-fixable tslint failures",
                "changes": [
                    {
                        "fileName": mockFileName,
                        "textChanges": [
                            {
                                "start": {
                                    "line": 1,
                                    "offset": 8
                                },
                                "end": {
                                    "line": 1,
                                    "offset": 14
                                },
                                "newText": ""
                            },
                            {
                                "start": {
                                    "line": 1,
                                    "offset": 20
                                },
                                "end": {
                                    "line": 1,
                                    "offset": 21
                                },
                                "newText": "[]"
                            },
                            {
                                "start": {
                                    "line": 2,
                                    "offset": 8
                                },
                                "end": {
                                    "line": 2,
                                    "offset": 14
                                },
                                "newText": ""
                            },
                            {
                                "start": {
                                    "line": 2,
                                    "offset": 20
                                },
                                "end": {
                                    "line": 2,
                                    "offset": 21
                                },
                                "newText": "[]"
                            }
                        ]
                    }
                ]
            },
            {
                "fixName": "tslint:disable:array-type",
                "description": "Disable rule 'array-type'",
                "changes": [
                    {
                        "fileName": mockFileName,
                        "textChanges": [
                            {
                                "start": {
                                    "line": 1,
                                    "offset": 1
                                },
                                "end": {
                                    "line": 1,
                                    "offset": 1
                                },
                                "newText": "// tslint:disable-next-line: array-type\n"
                            }
                        ]
                    }
                ]
            }
        ]);

        assert.isTrue(combinedFixesResponse.success);
        assert.deepEqual(combinedFixesResponse.body, {
            "changes": [
                {
                    "fileName": mockFileName,
                    "textChanges": [
                        {
                            "start": {
                                "line": 1,
                                "offset": 8
                            },
                            "end": {
                                "line": 1,
                                "offset": 14
                            },
                            "newText": ""
                        },
                        {
                            "start": {
                                "line": 1,
                                "offset": 20
                            },
                            "end": {
                                "line": 1,
                                "offset": 21
                            },
                            "newText": "[]"
                        }
                    ]
                },
                {
                    "fileName": mockFileName,
                    "textChanges": [
                        {
                            "start": {
                                "line": 2,
                                "offset": 8
                            },
                            "end": {
                                "line": 2,
                                "offset": 14
                            },
                            "newText": ""
                        },
                        {
                            "start": {
                                "line": 2,
                                "offset": 20
                            },
                            "end": {
                                "line": 2,
                                "offset": 21
                            },
                            "newText": "[]"
                        }
                    ]
                }
            ]
        });
    });

    it('should not return ts-lint fixes on non-tslint errors', async () => {
        server = createServerForFile(
            `const a = 1; a = 2`
        );
        await getCodeFixes(server, {
            startLine: 1,
            startOffset: 13,
            endLine: 1,
            endOffset: 14,
        });
        await server.close();
        const codeFixesResponse = await getFirstResponseOfType('getCodeFixes', server);

        assert.isTrue(codeFixesResponse.success);
        assert.deepEqual(codeFixesResponse.body, []);
    });

    it('should not return TS Lint fix-all for non-fixable errors', async () => {
        server = createServerForFile(
            `const foo = 123; food`
        );
        await getCodeFixes(server, {
            startLine: 1,
            startOffset: 18,
            endLine: 1,
            endOffset: 22,
            additionalErrorCodes: [2552]
        });
        await server.close();
        const codeFixesResponse = await getFirstResponseOfType('getCodeFixes', server);

        assert.isTrue(codeFixesResponse.success);
        assert.deepEqual(codeFixesResponse.body.length, 2);
        assert.deepEqual(codeFixesResponse.body[0].fixName, 'spelling');
        assert.deepEqual(codeFixesResponse.body[1].fixName, 'tslint:disable:no-unused-expression');
    });

    it('disable comment should be correctly indented', async () => {
        server = createServerForFile(
            '{',
            '    const a = 1',
            '}'
        );
        await getCodeFixes(server, {
            startLine: 2,
            startOffset: 16,
            endLine: 2,
            endOffset: 16,
            additionalErrorCodes: [2552]
        });
        await server.close();
        const codeFixesResponse = await getFirstResponseOfType('getCodeFixes', server);

        assert.isTrue(codeFixesResponse.success);
        assert.deepEqual(codeFixesResponse.body.length, 3);
        const disableFix = codeFixesResponse.body[2];
        const change = disableFix.changes[0].textChanges[0];
        assert.strictEqual(change.start.line, 2);
        assert.strictEqual(change.start.offset, 1);
        assert.strictEqual(change.newText, '    // tslint:disable-next-line: semicolon\n');
    });
});
