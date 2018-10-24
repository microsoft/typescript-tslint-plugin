import { TSLintPlugin } from './plugin';
import * as ts_module from 'typescript/lib/tsserverlibrary';
import { Logger } from './logger';

export = function init({ typescript }: { typescript: typeof ts_module }) {
    return {
        create(info: ts.server.PluginCreateInfo) {
            const logger = Logger.forPlugin(info);

            return new TSLintPlugin(typescript, logger, info.project, info.config)
                .decorate(info.languageService);
        },
    };
};
