import { TSLintPlugin } from './plugin';
import * as ts_module from 'typescript/lib/tsserverlibrary';
import { Logger } from './logger';

export = function init({ typescript }: { typescript: typeof ts_module }) {
    return {
        create(info: ts.server.PluginCreateInfo) {
            const logger = Logger.forPlugin(info);

            if (!isValidTypeScriptVersion(typescript)) {
                logger.info('Invalid typescript version detected. The TSLint plugin requires a version of TS with a services version between 0.8 and 1.0');
                return info.languageService;
            }

            return new TSLintPlugin(typescript, logger, info.project, info.config)
                .decorate(info.languageService);
        },
    };
};

function isValidTypeScriptVersion(typescript: typeof ts_module): boolean {
    const servicesVersion = typescript.servicesVersion;
    const [major, minor] = servicesVersion.split('.');
    return (+major === 0 && +minor >= 8);
}
