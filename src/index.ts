import { TSLintPlugin } from './plugin';
import * as ts_module from 'typescript/lib/tsserverlibrary';
import { Logger } from './logger';
import { ConfigurationManager } from './settings';
import * as mockRequire from 'mock-require';

export = function init({ typescript }: { typescript: typeof ts_module }) {
    const configManager = new ConfigurationManager(typescript);
    let logger: Logger | undefined;

    // Make sure TS Lint imports the correct version of TS
    mockRequire('typescript', typescript);

    return {
        create(info: ts.server.PluginCreateInfo) {
            logger = Logger.forPlugin(info);
            logger.info('Create');

            configManager.setProject(info.project, logger);
            configManager.updateFromPluginConfig(info.config);

            if (!isValidTypeScriptVersion(typescript)) {
                logger.info('Invalid typescript version detected. The TSLint plugin requires a version of TS with a services version between 0.8 and 1.0');
                return info.languageService;
            }

            return new TSLintPlugin(typescript, logger, info.project, configManager)
                .decorate(info.languageService);
        },
        onConfigurationChanged(config: any) {
            if (logger) {
                logger.info('onConfigurationChanged');
            }
            configManager.updateFromPluginConfig(config);
        },
    };
};

function isValidTypeScriptVersion(typescript: typeof ts_module): boolean {
    const servicesVersion = typescript.servicesVersion;
    const [major, minor] = servicesVersion.split('.');
    return (+major === 0 && +minor >= 8);
}
