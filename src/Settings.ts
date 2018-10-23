/**
 * Settings for the plugin section in tsconfig.json
 */
export interface Settings {
    alwaysShowRuleFailuresAsWarnings?: boolean;
    ignoreDefinitionFiles?: boolean;
    configFile?: string;
    disableNoUnusedVariableRule?: boolean; // support to enable/disable the workaround for https://github.com/Microsoft/TypeScript/issues/15344
    suppressWhileTypeErrorsPresent: boolean;
}