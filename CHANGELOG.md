# Changelog

## 0.2.1 - December 14, 2018
- Fix `ignoreDefinitionFiles` defaulting to false.

## 0.2.0 - December 12, 2018
- Allowing configuring `excluded` files. Thanks @vemoo!
- Default `alwaysShowRuleFailuresAsWarnings` to true. Set `"alwaysShowRuleFailuresAsWarnings": false` to restore the old behavior.
- Removing logic for older TS lint versions. Only TSlint5 was ever officially supported but there was still some logic for handling older tslint4.
- Don't show error in editor if `tslint` can't be found. We still log an error in the TS Server but do not generate an editor warning.

## 0.1.2 - November 28, 2018
- Always show a disable rule fix for TSLint errors. Thanks @reduckted!

## 0.1.1 - November 27, 2018
- Fix bug that could cause TS Lint to use a different version of TypeScript than the version being used by the plugin. This would result in unexpected behavior.

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