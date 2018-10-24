import * as path from 'path';

/**
 * Settings for the plugin section in tsconfig.json
 */
export interface Settings {
    readonly alwaysShowRuleFailuresAsWarnings?: boolean;
    readonly ignoreDefinitionFiles?: boolean;
    readonly configFile?: string;
    readonly disableNoUnusedVariableRule?: boolean; // support to enable/disable the workaround for https://github.com/Microsoft/TypeScript/issues/15344
    readonly suppressWhileTypeErrorsPresent: boolean;
}

export function loadSettingsFromTSConfig(config: any, projectRoot: string) {
    if (!config.configFile) {
        return config;
    }
    if (path.isAbsolute(config.configFile)) {
        return config;
    }
    config.configFile = path.join(projectRoot, config.configFile);
    return config;
}
