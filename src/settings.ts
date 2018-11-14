import * as path from 'path';
import * as ts_module from 'typescript/lib/tsserverlibrary';
import { pluginId } from './config';

/**
 * Settings for the plugin section in tsconfig.json
 */
export interface Settings {
    readonly alwaysShowRuleFailuresAsWarnings?: boolean;
    readonly ignoreDefinitionFiles?: boolean;
    readonly configFile?: string;
    readonly suppressWhileTypeErrorsPresent?: boolean;
    readonly jsEnable?: boolean;
}

export function loadSettingsFromPluginConfig(
    config: any,
    projectRoot: string,
): Settings {
    if (!config.configFile) {
        return config;
    }
    if (path.isAbsolute(config.configFile)) {
        return config;
    }
    config.configFile = path.join(projectRoot, config.configFile);
    return config;
}

export function loadSettingsFromTsConfig(
    ts: typeof ts_module,
    configFilePath: string,
    projectRoot: string,
): Settings | undefined {
    const configFileResult = ts.readConfigFile(configFilePath, ts.sys.readFile);
    if (configFileResult.error || !configFileResult.config) {
        return undefined;
    }

    if (!configFileResult.config.compilerOptions || !Array.isArray(configFileResult.config.compilerOptions.plugins)) {
        return undefined;
    }

    const pluginSettings = (configFileResult.config.compilerOptions.plugins as any[]).find(x => x.name === pluginId);
    if (!pluginSettings) {
        return undefined;
    }

    return loadSettingsFromPluginConfig(pluginSettings, projectRoot);
}