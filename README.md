# tslint-language-service

[![Build Status](https://secure.travis-ci.org/angelozerr/tslint-language-service.png)](http://travis-ci.org/angelozerr/tslint-language-service)
[![NPM version](https://img.shields.io/npm/v/tslint-language-service.svg)](https://www.npmjs.org/package/tslint-language-service)  

TypeScript `2.3` plugin for [tslint](https://github.com/palantir/tslint) which uses the same idea than the [@angular/language-service](https://github.com/angular/angular/tree/master/packages/language-service/).

To use it, 

 * add in your `node_modules` this project
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
 
 * execute tsserver with [tsserver-plugins](https://github.com/angelozerr/tsserver-plugins) by waiting for TypeScript 2.3

