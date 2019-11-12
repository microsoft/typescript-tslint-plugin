# Changelog

## 0.5.5 - November 11, 2019
- Restore old cwd after linting finishes.

## 0.5.4 - July 10, 2019
- Make sure we pass along packageManager from plugin.

## 0.5.3 - June 28, 2019
- Fixed the disable quick fix not having correct indentation.

## 0.5.2 - June 21, 2019
- Fixes the config file diagnostic not having `tslint` as its source.

## 0.5.1 - June 21, 2019
- Fixes `mjs` files being linted by default.

## 0.5.0 - June 10, 2019
- Add pnpm as `packageManager` option.

## 0.4.0 - May 21, 2019
- Try to help users better understand why tslint is not enabled by generating warnings if there is a `tslint.json` and the tslint library cannot be found or generates an error.

## 0.3.1 - January 31, 2019
- Fix the `fix-all` action show up even on non-autofixable errors.

## 0.3.0 - January 21, 2019
- Set `fixName` on returned actions. Thanks @kondi!
- Fix TS Lint's fix all quick fix showing up on non-tslint errors.
- Use `getCombinedQuickFixes` to compute 'fix all of X' errors. 

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