"use strict";
var ts = require("typescript");
var tslint = require("tslint");
var path = require("path");
var errorCodeMappings = {
    "quotemark": 7000,
    "no-trailing-whitespace": 7001,
    "no-var-keyword": 7002
};
var codeFixActions = Object.create(null);
function computeKey(start, end) {
    return "[" + start + "," + end + "]";
}
function create(info /* ts.server.PluginCreateInfo */) {
    // Create the proxy
    var proxy = Object.create(null);
    var oldLS = info.languageService;
    var _loop_1 = function (k) {
        proxy[k] = function () { return oldLS[k].apply(oldLS, arguments); };
    };
    for (var k in oldLS) {
        _loop_1(k);
    }
    function tryOperation(attempting, callback) {
        try {
            callback();
        }
        catch (e) {
            info.project.projectService.logger.info("Failed to " + attempting + ": " + e.toString());
            info.project.projectService.logger.info("Stack trace: " + e.stack);
        }
    }
    function makeDiagnostic(problem, file) {
        var message = (problem.getRuleName() !== null)
            ? problem.getFailure() + " (" + problem.getRuleName() + ")"
            : "" + problem.getFailure();
        var diagnostic = {
            file: file,
            start: problem.getStartPosition().getPosition(),
            length: problem.getEndPosition().getPosition() - problem.getStartPosition().getPosition(),
            messageText: message,
            category: ts.DiagnosticCategory.Warning,
            code: errorCodeMappings[problem.getRuleName()] || 6999,
        };
        return diagnostic;
    }
    /**
     * Filter failures for the given document
     */
    function filterProblemsForDocument(documentPath, failures) {
        var normalizedPath = path.normalize(documentPath);
        // we only show diagnostics targetting this open document, some tslint rule return diagnostics for other documents/files
        var normalizedFiles = {};
        return failures.filter(function (each) {
            var fileName = each.getFileName();
            if (!normalizedFiles[fileName]) {
                normalizedFiles[fileName] = path.normalize(fileName);
            }
            return normalizedFiles[fileName] === normalizedPath;
        });
    }
    var tsserver = info.ts;
    function registerCodeFix(action) {
        tsserver.codefix.registerCodeFix(action);
    }
    registerCodeFixes(registerCodeFix);
    function recordCodeAction(problem, file) {
        var fix = null;
        // tslint can return a fix with an empty replacements array, these fixes are ignored
        if (problem.getFix && problem.getFix() && problem.getFix().replacements.length > 0) {
            fix = problem.getFix(); // createAutoFix(problem, document, problem.getFix());
        }
        if (!fix) {
            return;
        }
        var documentAutoFixes = codeFixActions[file.fileName];
        if (!documentAutoFixes) {
            documentAutoFixes = Object.create(null);
            codeFixActions[file.fileName] = documentAutoFixes;
        }
        documentAutoFixes[computeKey(problem.getStartPosition().getPosition(), problem.getEndPosition().getPosition())] = fix;
    }
    var options = { fix: false };
    proxy.getSemanticDiagnostics = function (fileName) {
        var base = oldLS.getSemanticDiagnostics(fileName);
        if (base === undefined) {
            base = [];
        }
        tryOperation('get diagnostics', function () {
            info.project.projectService.logger.info("Computing tslint semantic diagnostics...");
            delete codeFixActions[fileName];
            var linter = new tslint.Linter(options, oldLS.getProgram());
            linter.lint(fileName, ""); // , source, configuration)
            var result = linter.getResult();
            if (result.failureCount > 0) {
                var ours = filterProblemsForDocument(fileName, result.failures);
                if (ours && ours.length) {
                    var file_1 = oldLS.getProgram().getSourceFile(fileName);
                    base.push.apply(base, ours.map(function (d) { return makeDiagnostic(d, file_1); }));
                    ours.forEach(function (problem) {
                        recordCodeAction(problem, file_1);
                    });
                }
            }
        });
        return base;
    };
    proxy.getCodeFixesAtPosition = function (fileName, start, end, errorCodes) {
        var base = oldLS.getCodeFixesAtPosition(fileName, start, end, errorCodes);
        if (base === undefined) {
            base = [];
        }
        var documentFixes = codeFixActions[fileName];
        if (documentFixes) {
            var fix = documentFixes[computeKey(start, end)];
            if (fix && fix.replacements) {
                var textChanges = fix.replacements.map(function (each) { return convertReplacementToTextChange(each); });
                base.push({
                    description: "Fix '" + fix.ruleName + "'",
                    changes: [{
                            fileName: fileName,
                            textChanges: textChanges
                        }]
                });
            }
        }
        return base;
    };
    return proxy;
}
exports.create = create;
function convertReplacementToTextChange(repl) {
    return {
        newText: repl.text,
        span: { start: repl.start, length: repl.length }
    };
}
function registerCodeFixes(registerCodeFix) {
    // Code fix for "quotemark"    
    registerCodeFix({
        errorCodes: [errorCodeMappings["quotemark"]],
        getCodeActions: function (context) {
            var sourceFile = context.sourceFile;
            var start = context.span.start;
            var length = context.span.length;
            var token = utils.getTokenAtPosition(sourceFile, start);
            var text = token.getText(sourceFile);
            var wrongQuote = text[0];
            var fixedQuote = wrongQuote === "'" ? "\"" : "'";
            var newText = "" + fixedQuote + text.substring(1, text.length - 1) + fixedQuote;
            var result = [{
                    description: "Change to " + newText,
                    changes: [{
                            fileName: sourceFile.fileName,
                            textChanges: [{ newText: newText, span: { start: start, length: length } }]
                        }]
                }];
            return result;
        }
    });
    // Code fix for "no-trailing-whitespace"
    registerCodeFix({
        errorCodes: [errorCodeMappings["no-trailing-whitespace"]],
        getCodeActions: function (context) {
            var sourceFile = context.sourceFile;
            var start = context.span.start;
            var length = context.span.length;
            var result = [{
                    description: "Remove whitespaces.",
                    changes: [{
                            fileName: sourceFile.fileName,
                            textChanges: [{ newText: "", span: { start: start, length: length } }]
                        }]
                }];
            return result;
        }
    });
    // Code fix for "no-var-keyword"
    registerCodeFix({
        errorCodes: [errorCodeMappings["no-var-keyword"]],
        getCodeActions: function (context) {
            var sourceFile = context.sourceFile;
            var start = context.span.start;
            var length = context.span.length;
            var result = [{
                    description: "Replace with 'let'.",
                    changes: [{
                            fileName: sourceFile.fileName,
                            textChanges: [{ newText: "let", span: { start: start, length: length } }]
                        }
                    ]
                },
                {
                    description: "Replace with 'const'.",
                    changes: [{
                            fileName: sourceFile.fileName,
                            textChanges: [{ newText: "const", span: { start: start, length: length } }]
                        }
                    ]
                }];
            return result;
        }
    });
    // Code fix for other tslint fixes
    registerCodeFix({
        errorCodes: [6999],
        getCodeActions: function (context) {
            return null;
        }
    });
}
/* @internal */
var utils;
(function (utils) {
    /** Returns a token if position is in [start-of-leading-trivia, end) */
    function getTokenAtPosition(sourceFile, position, includeJsDocComment) {
        if (includeJsDocComment === void 0) { includeJsDocComment = false; }
        return getTokenAtPositionWorker(sourceFile, position, /*allowPositionInLeadingTrivia*/ true, /*includeItemAtEndPosition*/ undefined, includeJsDocComment);
    }
    utils.getTokenAtPosition = getTokenAtPosition;
    /** Get the token whose text contains the position */
    function getTokenAtPositionWorker(sourceFile, position, allowPositionInLeadingTrivia, includeItemAtEndPosition, includeJsDocComment) {
        if (includeJsDocComment === void 0) { includeJsDocComment = false; }
        var current = sourceFile;
        outer: while (true) {
            if (isToken(current)) {
                // exit early
                return current;
            }
            /*if (includeJsDocComment) {
                const jsDocChildren = ts.filter(current.getChildren(), isJSDocNode);
                for (const jsDocChild of jsDocChildren) {
                    const start = allowPositionInLeadingTrivia ? jsDocChild.getFullStart() : jsDocChild.getStart(sourceFile, includeJsDocComment);
                    if (start <= position) {
                        const end = jsDocChild.getEnd();
                        if (position < end || (position === end && jsDocChild.kind === SyntaxKind.EndOfFileToken)) {
                            current = jsDocChild;
                            continue outer;
                        }
                        else if (includeItemAtEndPosition && end === position) {
                            const previousToken = findPrecedingToken(position, sourceFile, jsDocChild);
                            if (previousToken && includeItemAtEndPosition(previousToken)) {
                                return previousToken;
                            }
                        }
                    }
                }
            }*/
            // find the child that contains 'position'
            for (var _i = 0, _a = current.getChildren(); _i < _a.length; _i++) {
                var child = _a[_i];
                // all jsDocComment nodes were already visited
                if (isJSDocNode(child)) {
                    continue;
                }
                var start = allowPositionInLeadingTrivia ? child.getFullStart() : child.getStart(sourceFile, includeJsDocComment);
                if (start <= position) {
                    var end = child.getEnd();
                    if (position < end || (position === end && child.kind === ts.SyntaxKind.EndOfFileToken)) {
                        current = child;
                        continue outer;
                    }
                    else if (includeItemAtEndPosition && end === position) {
                        var previousToken = findPrecedingToken(position, sourceFile, child);
                        if (previousToken && includeItemAtEndPosition(previousToken)) {
                            return previousToken;
                        }
                    }
                }
            }
            return current;
        }
    }
    function findPrecedingToken(position, sourceFile, startNode) {
        return find(startNode || sourceFile);
        function findRightmostToken(n) {
            if (isToken(n)) {
                return n;
            }
            var children = n.getChildren();
            var candidate = findRightmostChildNodeWithTokens(children, /*exclusiveStartPosition*/ children.length);
            return candidate && findRightmostToken(candidate);
        }
        function find(n) {
            if (isToken(n)) {
                return n;
            }
            var children = n.getChildren();
            for (var i = 0; i < children.length; i++) {
                var child = children[i];
                // condition 'position < child.end' checks if child node end after the position
                // in the example below this condition will be false for 'aaaa' and 'bbbb' and true for 'ccc'
                // aaaa___bbbb___$__ccc
                // after we found child node with end after the position we check if start of the node is after the position.
                // if yes - then position is in the trivia and we need to look into the previous child to find the token in question.
                // if no - position is in the node itself so we should recurse in it.
                // NOTE: JsxText is a weird kind of node that can contain only whitespaces (since they are not counted as trivia).
                // if this is the case - then we should assume that token in question is located in previous child.
                if (position < child.end && (nodeHasTokens(child) || child.kind === ts.SyntaxKind.JsxText)) {
                    var start = child.getStart(sourceFile);
                    var lookInPreviousChild = (start >= position) ||
                        (child.kind === ts.SyntaxKind.JsxText && start === child.end); // whitespace only JsxText
                    if (lookInPreviousChild) {
                        // actual start of the node is past the position - previous token should be at the end of previous child
                        var candidate = findRightmostChildNodeWithTokens(children, /*exclusiveStartPosition*/ i);
                        return candidate && findRightmostToken(candidate);
                    }
                    else {
                        // candidate should be in this node
                        return find(child);
                    }
                }
            }
            // Debug.assert(startNode !== undefined || n.kind === SyntaxKind.SourceFile);
            // Here we know that none of child token nodes embrace the position,
            // the only known case is when position is at the end of the file.
            // Try to find the rightmost token in the file without filtering.
            // Namely we are skipping the check: 'position < node.end'
            if (children.length) {
                var candidate = findRightmostChildNodeWithTokens(children, /*exclusiveStartPosition*/ children.length);
                return candidate && findRightmostToken(candidate);
            }
        }
        /// finds last node that is considered as candidate for search (isCandidate(node) === true) starting from 'exclusiveStartPosition'
        function findRightmostChildNodeWithTokens(children, exclusiveStartPosition) {
            for (var i = exclusiveStartPosition - 1; i >= 0; i--) {
                if (nodeHasTokens(children[i])) {
                    return children[i];
                }
            }
        }
    }
    utils.findPrecedingToken = findPrecedingToken;
    function nodeHasTokens(n) {
        // If we have a token or node that has a non-zero width, it must have tokens.
        // Note, that getWidth() does not take trivia into account.
        return n.getWidth() !== 0;
    }
    function isToken(n) {
        return n.kind >= ts.SyntaxKind.FirstToken && n.kind <= ts.SyntaxKind.LastToken;
    }
    utils.isToken = isToken;
    function isJSDocNode(node) {
        return node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode;
    }
    utils.isJSDocNode = isJSDocNode;
})(utils || (utils = {}));
//# sourceMappingURL=ts_plugin.js.map