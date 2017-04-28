# tslint-language-service

[![Build Status](https://secure.travis-ci.org/angelozerr/tslint-language-service.png)](http://travis-ci.org/angelozerr/tslint-language-service)
[![NPM version](https://img.shields.io/npm/v/tslint-language-service.svg)](https://www.npmjs.org/package/tslint-language-service)  

TypeScript [language service plugin](https://blogs.msdn.microsoft.com/typescript/2017/04/27/announcing-typescript-2-3/) for [tslint](https://github.com/palantir/tslint). 

To use it the plugin:

 * install the plugin with `npm install tslint-language-service`
 
 * enable the plugin in your `tsconfig.json` file:

```json
{
  "compilerOptions": {
    "plugins": [
      { "name": "tslint-language-service"}
    ]
  }
}
```

 * If you are using TypeScript < 2.2.1, you must execute tsserver with [tsserver-plugins](https://github.com/angelozerr/tsserver-plugins).
 
Your `node_modules` folder should look like this:

* node_modules
  * tslint
  * tslint-language-service
  * typescript

**Notice** due to an issue in the implementation of the `no-unused-variable` rule ([issue[15344](https://github.com/Microsoft/TypeScript/issues/15344)]), this rule will be disabled by the plugin. You can use the typescript compiler options `noUnusedLocals` and `noUnusedParameters` instead. 
 
# Editors Support
 
All editors which consumes tsserver (VSCode, Sublime, Eclipse, etc) can use `tslint-language-service`. Here a demo with [Eclipse](https://github.com/angelozerr/typescript.java) and `tslint 5.0.0`

![tslint demo](images/TslintLanguageServiceDemo.gif)

## Eclipse

Install [typescript.java](https://github.com/angelozerr/typescript.java/wiki/Installation-Update-Site) and you can use the `TypeScript Project wizard` which configures tslint-language-service.

## VSCode

Visual Studio code provides a [vscode-tslint](https://marketplace.visualstudio.com/items?itemName=eg2.tslint) extension, to avoid that the a file is linted twice you should disable this extension.

The most important differences between the `vscode-tslint` extension and the `tslint-languageservice-plugin` are:
- the plugin shares the program representation with TypeScript. This is more efficient than the `vscode-tslint` extension which needs 
  to reanalyze the document. Since `vscode-tslint` lints one file a time only, it cannot support tslint rules that require the type checker. The language service plugin doesn't have this limitation.
- `vscode-tslint` provides additional [features](https://marketplace.visualstudio.com/items?itemName=eg2.tslint), please file issue requests for the features you are missing.

To use the plugin with VS Code:
- If you are using the `vscode-tslint` extension disable or uninstall it.
- Install the `tslint-language-service` and `tslint` as described above into your workspace.

![tslint demo VS Code](images/TslintLanguageServiceDemoVSCode.gif)


 

