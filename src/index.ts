import { TSLintPlugin } from './plugin';
import * as ts_module from 'typescript/lib/tsserverlibrary';
import { Logger } from './logger';
import { ConfigurationManager } from './settings';
import * as mockRequire from 'mock-require';

export = function init({ typescript }: { typescript: typeof ts_module }) {
    const configManager = new ConfigurationManager(typescript);
    let logger: Logger | undefined;

    // مطمئن باشید که تی اس لینت ایپورت کرده نسخه صحیح از تایپ اسکریپ را
    // Make sure TS Lint imports the correct version of TS
    mockRequire('typescript', typescript);

    return {
        create(info: ts.server.PluginCreateInfo) {
            logger = Logger.forPlugin(info);
            logger.info('Create');

            configManager.setProject(info.project, logger);
            configManager.updateFromPluginConfig(info.config);

            if (!isValidTypeScriptVersion(typescript)) {
                logger.info('Invalid typescript version detected. The TSLint plugin requires TypeScript 3.x');
                return info.languageService;
            }

            return new TSLintPlugin(typescript, info.languageServiceHost, logger, info.project, configManager)
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
    const [major] = typescript.version.split('.');
    return +major >= 3;
}
