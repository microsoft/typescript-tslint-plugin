import * as path from 'path';
import * as ts_module from 'typescript/lib/tsserverlibrary';
import { Logger } from './logger';
import { pluginId } from './config';

/**
 * Settings for the plugin section in tsconfig.json
 */
export interface Configuration {
    readonly alwaysShowRuleFailuresAsWarnings?: boolean;
    readonly ignoreDefinitionFiles?: boolean;
    readonly configFile?: string;
    readonly suppressWhileTypeErrorsPresent?: boolean;
    readonly jsEnable?: boolean;
    readonly exclude?: string | string[];
}

export class ConfigurationManager {

    private readonly _configUpdatedListeners = new Set<() => void>();

    private _workingDirectory?: string;
    private _watcher?: ts_module.FileWatcher;

    public get config(): Configuration { return this._configuration; }
    private _configuration: Configuration = {};

    public constructor(
        private readonly _ts: typeof ts_module
    ) { }

    public updateFromPluginConfig(config: Configuration) {
        const configFile = config.configFile && !path.isAbsolute(config.configFile) && this._workingDirectory
            ? path.join(this._workingDirectory, config.configFile)
            : config.configFile;

        this._configuration = {
            ...config,
            configFile,
        };

        for (const listener of this._configUpdatedListeners) {
            listener();
        }
    }

    public setProject(
        project: ts_module.server.Project,
        logger: Logger,
    ) {
        if (this._watcher) {
            this._watcher.close();
            this._watcher = undefined;
        }

        // Watch config file for changes
        if (project instanceof this._ts.server.ConfiguredProject && this._ts.sys.watchFile) {
            const configFile = project.getConfigFilePath();
            logger.info(`ConfigurationManager: Found configured project: ${configFile}`);

            this._watcher = this._ts.sys.watchFile(configFile, (_fileName: string, eventKind: ts_module.FileWatcherEventKind) => {
                if (eventKind !== this._ts.FileWatcherEventKind.Changed) {
                    return;
                }

                logger.info('ConfigurationManager: file changed');

                const newConfig = loadSettingsFromTsConfig(this._ts, configFile, logger);
                if (!newConfig) {
                    logger.info(`ConfigurationManager: Could not read new config`);
                    return;
                }

                logger.info(`ConfigurationManager: Updating config settings: ${JSON.stringify(newConfig)}`);
                this.updateFromPluginConfig(newConfig);
            });
        }

        this._workingDirectory = project.getCurrentDirectory();
        this.updateFromPluginConfig(this.config);
    }

    public onUpdatedConfig(listener: () => void) {
        this._configUpdatedListeners.add(listener);
    }
}

export function loadSettingsFromTsConfig(
    ts: typeof ts_module,
    configFilePath: string,
    logger: Logger,
): Configuration | undefined {
    const configFileResult = ts.readConfigFile(configFilePath, ts.sys.readFile);
    if (configFileResult.error || !configFileResult.config) {
        logger.info(`ConfigurationManager: Could not read new config: ${configFileResult.error}`);
        return undefined;
    }

    if (!configFileResult.config.compilerOptions || !Array.isArray(configFileResult.config.compilerOptions.plugins)) {
        logger.info(`ConfigurationManager: Could not read new config plugins`);

        return undefined;
    }

    const pluginSettings = (configFileResult.config.compilerOptions.plugins as any[]).find(x => x.name === pluginId);
    if (!pluginSettings) {
        logger.info(`ConfigurationManager: Could not read new config tslint-plugin`);
        return undefined;
    }

    return pluginSettings;
}
