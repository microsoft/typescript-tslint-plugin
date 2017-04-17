# tslint-language-service

[![Build Status](https://secure.travis-ci.org/angelozerr/tslint-language-service.png)](http://travis-ci.org/angelozerr/tslint-language-service)
[![NPM version](https://img.shields.io/npm/v/tslint-language-service.svg)](https://www.npmjs.org/package/tslint-language-service)  

TypeScript `2.3` plugin for [tslint](https://github.com/palantir/tslint) which uses the same idea than the [@angular/language-service](https://github.com/angular/angular/tree/master/packages/language-service/).

To use it, 

 * `npm install tslint-language-service
 * in your `tsconfig.json` declare the use of the plugin:

```json
{
  "compilerOptions": {
    "plugins": [
      { "name": "tslint-language-service"}
    ]
  }
}
```
 
