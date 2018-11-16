# Changelog

## 0.1.0 - November 16, 2018
- Add support for configuring the plugin from an editor.
- Correctly observe changes to the `tsconfig`/`jsconfig`.
- Fix error that could cause duplicate tslint errors to be reported.

## 0.0.7 - November 15, 2018
- Fix potential state corruption error when using TS 3.2.

## 0.0.6 - November 13, 2018
- Add `enableJs` option to enable/disable validating js. Default to `false`.

## 0.0.5 - November 5, 2018
- Use diagnostic as label for quick fixes
- Enable for js files included in tsconfig.

## 0.0.4 - October 23, 2018
- Fix spelling of setting name

## 0.0.3 - October 22, 2018
- Don't call `getProgram` directly since it may corrupt the TS Server state
- Exclude some files from npm package.

## 0.0.2 - October 19, 2018

- Initial release