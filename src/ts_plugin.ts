import * as ts from 'typescript';
import * as tslint from 'tslint';
import * as path from 'path';

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
            console.error(e)
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
            code: 0,
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
    
    let options: tslint.ILinterOptions = {fix: false};
    
    proxy.getSemanticDiagnostics = function( fileName: string ) {
        let base = oldLS.getSemanticDiagnostics( fileName );
        if ( base === undefined ) {
            base = [];
        }
        tryOperation( 'get diagnostics', () => {
            info.project.projectService.logger.info( `Computing Angular semantic diagnostics...` );
            
            var linter = new tslint.Linter(options, oldLS.getProgram());
            linter.lint(fileName, ""); //, source, configuration)
            let result = linter.getResult();

            if (result.failureCount > 0) {
                const ours = filterProblemsForDocument(fileName, result.failures);
                if ( ours && ours.length ) {
                  const file = oldLS.getProgram().getSourceFile( fileName );
                  base.push.apply( base, ours.map( d => makeDiagnostic( d, file ) ) );
              } 
            }            
        });

        return base;
    };

    return proxy;
}