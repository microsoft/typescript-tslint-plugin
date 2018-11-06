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
    it('should return fix and disables for single error aaaa', async () => {
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
                "fixName": "",
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
                "fixName": "",
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
                "fixName": "",
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
                                "newText": "// tslint:disable-next-line:array-type"
                            }
                        ]
                    }
                ]
            }
        ]);
    });

    it('should return individual fixes and fix all for multuple errors of same type in file', async () => {
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
                "fixName": "",
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
                "fixName": "",
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
                "fixName": "",
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
                "fixName": "",
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
                                "newText": "// tslint:disable-next-line:array-type"
                            }
                        ]
                    }
                ]
            }
        ]);
    });
});
