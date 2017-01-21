import * as ts from 'typescript';
import * as tslint from 'tslint';
import * as path from 'path';

let errorCodeMappings = {
    "quotemark": 7000,
    "no-trailing-whitespace": 7001,
    "no-var-keyword": 7002
};

interface AutoFix {
    label: string;
    documentVersion: number;
    problem: tslint.RuleFailure;
    // edits: TSLintAutofixEdit[];
}

interface Map<V> {
    [key: string]: V;
}


let codeFixActions: Map<Map<tslint.Fix>> = Object.create(null);

function computeKey(start: number, end: number): string {
    return `[${start},${end}]`;
}

export function create( info: any /* ts.server.PluginCreateInfo */ ): ts.LanguageService {
    // Create the proxy
    const proxy: ts.LanguageService = Object.create( null );
    const oldLS: ts.LanguageService = info.languageService;
    for ( const k in oldLS ) {
        ( <any>proxy )[k] = function() { return ( oldLS as any )[k].apply( oldLS, arguments ); };
    }

    function tryOperation( attempting: string, callback: () => void ) {
        try {
            callback();
        } catch ( e ) {
            info.project.projectService.logger.info( `Failed to ${attempting}: ${e.toString()}` );
            info.project.projectService.logger.info( `Stack trace: ${e.stack}` );
        }
    }

    function makeDiagnostic(problem: tslint.RuleFailure, file: ts.SourceFile): ts.Diagnostic {
        let message = (problem.getRuleName() !== null)
            ? `${problem.getFailure()} (${problem.getRuleName()})`
            : `${problem.getFailure()}`;
        let diagnostic: ts.Diagnostic = {
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
    function filterProblemsForDocument(documentPath: string, failures: tslint.RuleFailure[]): tslint.RuleFailure[] {
        let normalizedPath = path.normalize(documentPath);
        // we only show diagnostics targetting this open document, some tslint rule return diagnostics for other documents/files
        let normalizedFiles = {};
        return failures.filter(each => {
            let fileName = each.getFileName();
            if (!normalizedFiles[fileName]) {
                normalizedFiles[fileName] = path.normalize(fileName);
            }
            return normalizedFiles[fileName] === normalizedPath;
        });
    }

    let tsserver = info.ts;
    function registerCodeFix(action: codefix.CodeFix) {
        tsserver.codefix.registerCodeFix(action);
    }
    registerCodeFixes(registerCodeFix);

    function recordCodeAction(problem: tslint.RuleFailure, file: ts.SourceFile) {
        let fix: tslint.Fix = null;

        // tslint can return a fix with an empty replacements array, these fixes are ignored
        if (problem.getFix && problem.getFix() && problem.getFix().replacements.length > 0) { // tslint fixes are not available in tslint < 3.17
            fix = problem.getFix(); // createAutoFix(problem, document, problem.getFix());
        }

        if (!fix) {
            return;
        }

        let documentAutoFixes: Map<tslint.Fix> = codeFixActions[file.fileName];
        if (!documentAutoFixes) {
            documentAutoFixes = Object.create(null);
            codeFixActions[file.fileName] = documentAutoFixes;
        }
        documentAutoFixes[computeKey(problem.getStartPosition().getPosition(), problem.getEndPosition().getPosition())] = fix;
    }

    let options: tslint.ILinterOptions = {fix: false};

    proxy.getSemanticDiagnostics = function( fileName: string ) {
        let base = oldLS.getSemanticDiagnostics( fileName );
        if ( base === undefined ) {
            base = [];
        }

        tryOperation( 'get diagnostics', () => {
            info.project.projectService.logger.info( `Computing tslint semantic diagnostics...` );
            delete codeFixActions[fileName];
            let linter = new tslint.Linter(options, oldLS.getProgram());
            linter.lint(fileName, ""); // , source, configuration)
            let result = linter.getResult();

            if (result.failureCount > 0) {
                const ours = filterProblemsForDocument(fileName, result.failures);
                if ( ours && ours.length ) {
                  const file = oldLS.getProgram().getSourceFile( fileName );
                  base.push.apply( base, ours.map( d => makeDiagnostic( d, file ) ) );
                  ours.forEach(problem => {
                      recordCodeAction(problem, file);
                  });
              }
            }
        });

        return base;

    };

    proxy.getCodeFixesAtPosition = function( fileName: string, start: number, end: number, errorCodes: number[] ): ts.CodeAction[] {
        let base = oldLS.getCodeFixesAtPosition( fileName, start, end, errorCodes );
        if ( base === undefined ) {
            base = [];
        }
        let documentFixes = codeFixActions[fileName];
        if (documentFixes) {
            let fix = documentFixes[computeKey(start, end)];
            if (fix && fix.replacements) {
                const textChanges = fix.replacements.map(each => convertReplacementToTextChange(each));
                base.push({
                    description: `Fix '${fix.ruleName}'`,
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

function convertReplacementToTextChange(repl: tslint.Replacement): ts.TextChange {
    return {
        newText: repl.text,
        span: {start: repl.start, length: repl.length}
    };
}

function registerCodeFixes(registerCodeFix: (action: codefix.CodeFix) => void) {

    // Code fix for "quotemark"    
    registerCodeFix({
        errorCodes: [errorCodeMappings["quotemark"]],
        getCodeActions: (context: codefix.CodeFixContext) => {
            const sourceFile = context.sourceFile;
            const start = context.span.start;
            const length = context.span.length;
            const token = utils.getTokenAtPosition(sourceFile, start);

            const text = token.getText(sourceFile);
            const wrongQuote = text[0];
            const fixedQuote = wrongQuote === "'" ? "\"" : "'";
            const newText = `${fixedQuote}${text.substring(1, text.length - 1)}${fixedQuote}`;

            const result = [{
                description: `Change to ${newText}`,
                changes: [{
                    fileName: sourceFile.fileName,
                    textChanges: [{ newText: newText , span: { start: start, length: length } }]
                }]
            }];
            return result;
        }
    });

    // Code fix for "no-trailing-whitespace"
    registerCodeFix({
        errorCodes: [errorCodeMappings["no-trailing-whitespace"]],
        getCodeActions: (context: codefix.CodeFixContext) => {
            const sourceFile = context.sourceFile;
            const start = context.span.start;
            const length = context.span.length;
            const result = [{
                description: `Remove whitespaces.`,
                changes: [{
                    fileName: sourceFile.fileName,
                    textChanges: [{ newText: "" , span: { start: start, length: length } }]
                }]
            }];
            return result;
        }
    });

    // Code fix for "no-var-keyword"
    registerCodeFix({
        errorCodes: [errorCodeMappings["no-var-keyword"]],
        getCodeActions: (context: codefix.CodeFixContext) => {
            const sourceFile = context.sourceFile;
            const start = context.span.start;
            const length = context.span.length;
            const result = [{
                description: `Replace with 'let'.`,
                changes: [{
                    fileName: sourceFile.fileName,
                    textChanges: [{ newText: "let" , span: { start: start, length: length } }]
                }
                ]
            },
            {
                description: `Replace with 'const'.`,
                changes: [{
                    fileName: sourceFile.fileName,
                    textChanges: [{ newText: "const" , span: { start: start, length: length } }]
                }
                ]
            }];
            return result;
        }
    });

    // Code fix for other tslint fixes
    registerCodeFix({
        errorCodes: [6999],
        getCodeActions: (context: codefix.CodeFixContext) => {
            return null;
        }
    });

}

/* @internal */
namespace codefix {

    export interface CodeFix {
        errorCodes: number[];
        getCodeActions( context: CodeFixContext ): ts.CodeAction[] | undefined;
    }

    export interface CodeFixContext {
        errorCode: number;
        sourceFile: ts.SourceFile;
        span: ts.TextSpan;
        program: ts.Program;
        newLineCharacter: string;
        host: ts.LanguageServiceHost;
        cancellationToken: ts.CancellationToken;
    }
}

/* @internal */
namespace utils {

    /** Returns a token if position is in [start-of-leading-trivia, end) */
    export function getTokenAtPosition(sourceFile: ts.SourceFile, position: number, includeJsDocComment = false): ts.Node {
        return getTokenAtPositionWorker(sourceFile, position, /*allowPositionInLeadingTrivia*/ true, /*includeItemAtEndPosition*/ undefined, includeJsDocComment);
    }

    /** Get the token whose text contains the position */
    function getTokenAtPositionWorker(sourceFile: ts.SourceFile, position: number, allowPositionInLeadingTrivia: boolean, includeItemAtEndPosition: (n: ts.Node) => boolean, includeJsDocComment = false): ts.Node {
        let current: ts.Node = sourceFile;
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
            for (const child of current.getChildren()) {
                // all jsDocComment nodes were already visited
                if (isJSDocNode(child)) {
                    continue;
                }
                const start = allowPositionInLeadingTrivia ? child.getFullStart() : child.getStart(sourceFile, includeJsDocComment);
                if (start <= position) {
                    const end = child.getEnd();
                    if (position < end || (position === end && child.kind === ts.SyntaxKind.EndOfFileToken)) {
                        current = child;
                        continue outer;
                    }
                    else if (includeItemAtEndPosition && end === position) {
                        const previousToken = findPrecedingToken(position, sourceFile, child);
                        if (previousToken && includeItemAtEndPosition(previousToken)) {
                            return previousToken;
                        }
                    }
                }
            }

            return current;
        }
    }

    export function findPrecedingToken(position: number, sourceFile: ts.SourceFile, startNode?: ts.Node): ts.Node {
        return find(startNode || sourceFile);

        function findRightmostToken(n: ts.Node): ts.Node {
            if (isToken(n)) {
                return n;
            }

            const children = n.getChildren();
            const candidate = findRightmostChildNodeWithTokens(children, /*exclusiveStartPosition*/ children.length);
            return candidate && findRightmostToken(candidate);

        }

        function find(n: ts.Node): ts.Node {
            if (isToken(n)) {
                return n;
            }

            const children = n.getChildren();
            for (let i = 0; i < children.length; i++) {
                const child = children[i];
                // condition 'position < child.end' checks if child node end after the position
                // in the example below this condition will be false for 'aaaa' and 'bbbb' and true for 'ccc'
                // aaaa___bbbb___$__ccc
                // after we found child node with end after the position we check if start of the node is after the position.
                // if yes - then position is in the trivia and we need to look into the previous child to find the token in question.
                // if no - position is in the node itself so we should recurse in it.
                // NOTE: JsxText is a weird kind of node that can contain only whitespaces (since they are not counted as trivia).
                // if this is the case - then we should assume that token in question is located in previous child.
                if (position < child.end && (nodeHasTokens(child) || child.kind === ts.SyntaxKind.JsxText)) {
                    const start = child.getStart(sourceFile);
                    const lookInPreviousChild =
                        (start >= position) || // cursor in the leading trivia
                        (child.kind === ts.SyntaxKind.JsxText && start === child.end); // whitespace only JsxText

                    if (lookInPreviousChild) {
                        // actual start of the node is past the position - previous token should be at the end of previous child
                        const candidate = findRightmostChildNodeWithTokens(children, /*exclusiveStartPosition*/ i);
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
                const candidate = findRightmostChildNodeWithTokens(children, /*exclusiveStartPosition*/ children.length);
                return candidate && findRightmostToken(candidate);
            }
        }

        /// finds last node that is considered as candidate for search (isCandidate(node) === true) starting from 'exclusiveStartPosition'
        function findRightmostChildNodeWithTokens(children: ts.Node[], exclusiveStartPosition: number): ts.Node {
            for (let i = exclusiveStartPosition - 1; i >= 0; i--) {
                if (nodeHasTokens(children[i])) {
                    return children[i];
                }
            }
        }
    }

    function nodeHasTokens(n: ts.Node): boolean {
        // If we have a token or node that has a non-zero width, it must have tokens.
        // Note, that getWidth() does not take trivia into account.
        return n.getWidth() !== 0;
    }

    export function isToken(n: ts.Node): boolean {
        return n.kind >= ts.SyntaxKind.FirstToken && n.kind <= ts.SyntaxKind.LastToken;
    }

    export function isJSDocNode(node: ts.Node) {
        return node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode;
    }
}