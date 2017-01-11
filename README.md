# tslint-language-service

TypeScript 2.2 plugin for tslint which uses the same idea than the @angular/language-service https://github.com/angular/angular/tree/master/modules/%40angular/language-service

To use it, 

 * add in your node_modules this project
 * update tsserevr.js like this:

```typescript 
if (typeof ts === "undefined") {
  ts =  {};
}
var ts;
try {
  var NgLanguageServicePlugin = require("@angular/language-service")().create;
  var tslintPlugin = require("tslint-language-service").create;
  console.error(NgLanguageServicePlugin)
  var delegate;
  Object.defineProperty(ts, "createLanguageService", {
    get: function() {
      return function(host, documentRegistry) {
        const ls = delegate(host, documentRegistry);
        const nglsp = NgLanguageServicePlugin({
          languageServiceHost: host,
          languageService: ls,
          project: {projectService: {logger: {info: function() {}}}}
        });
        
        const lint = tslintPlugin({languageServiceHost: host,
                languageService: nglsp,
                project: {projectService: {logger: {info: function() {}}}}});
        /*const completionFn = ls.getCompletionsAtPosition;
        const samnticCheckFn = ls.getSemanticDiagnostics;
        ls.getCompletionsAtPosition = (filename, position) => {
          const ngResult = nglsp.getCompletionsAtPosition(filename, position);
          if (ngResult)
            return ngResult;
          return completionFn(filename, position);
        };
        ls.getSemanticDiagnostics = (fileName) => {
          return nglsp.getSemanticDiagnosticsFilter(fileName, samnticCheckFn(fileName));
        };*/
        return lint;
      }
    },
    set: function(v) {
      delegate = v;
    },
    configurable: true,
    enumerable: true
  });
} catch(e) {

console.error(e)
 }
``` 
