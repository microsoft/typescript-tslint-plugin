// @ts-check
const { assertSpan } = require('./assert');
const assert = require('chai').assert;
const path = require('path');
const createServer = require('../server-fixture');
const { openMockFile, getFirstResponseOfType } = require('./helpers');

const tslintSource = 'tslint';

const mockFileName = path.join(__dirname, '..', 'project-fixture', 'main.ts').replace(/\\/g, '/');

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
        errorCodes: [1]
    });

    return server.close().then(_ => {
        return getFirstResponseOfType('getCodeFixes', server);
    });
}

describe('CodeFixes', () => {
    it('should return fix and disables for single error', async () => {
        const errorResponse = await getCodeFixes(
            `let t: Array<string> = new Array<string>(); console.log(t);`, {
                startLine: 1,
                startOffset: 8,
                endLine: 1,
                endOffset: 21,
            });

        assert.isTrue(errorResponse.success);
        assert.deepEqual(errorResponse.body, [
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
        const errorResponse = await getCodeFixes(
            `let x: Array<string> = new Array<string>(); console.log(x);\nlet y: Array<string> = new Array<string>(); console.log(y);`, {
                startLine: 1,
                startOffset: 8,
                endLine: 1,
                endOffset: 21,
            });

        assert.isTrue(errorResponse.success);
        assert.strictEqual(errorResponse.body.length, 4);

        assert.deepEqual(errorResponse.body, [
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
                "description": "Fix all 'array-type'",
                "fixName": "tslint:fix-all:array-type",
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
    });

    it('should not return ts-lint fixes on non-tslint errors', async () => {
        const errorResponse = await getCodeFixes(
            `const a = 1; a = 2`, {
                startLine: 1,
                startOffset: 13,
                endLine: 1,
                endOffset: 14,
            });

        assert.isTrue(errorResponse.success);
        assert.deepEqual(errorResponse.body, []);
    });
});
