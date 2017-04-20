# tslint-language-service

[![Build Status](https://secure.travis-ci.org/angelozerr/tslint-language-service.png)](http://travis-ci.org/angelozerr/tslint-language-service)
[![NPM version](https://img.shields.io/npm/v/tslint-language-service.svg)](https://www.npmjs.org/package/tslint-language-service)  

TypeScript `2.2.1` plugin for [tslint](https://github.com/palantir/tslint) which uses the same idea than the [@angular/language-service](https://github.com/angular/angular/tree/master/packages/language-service/).

To use it:

 * install `tslint-language-service` with 

`npm install tslint-language-service`
 
 * declare in your `tsconfig.json` the plugin:

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
 
# Editor Support
 
All editors which consummes tsserver (VSCode, Sublime, Eclipse, etc) can use `tslint-language-service`. Here a demo with [Eclipse](https://github.com/angelozerr/typescript.java) and `tslint 5.0.0`

![tslint demo](images/TslintLanguageServiceDemo.gif)
 

