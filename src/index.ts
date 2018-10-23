import { TSLintPlugin } from './plugin';
import * as ts_module from 'typescript/lib/tsserverlibrary';

export = function init({ typescript }: { typescript: typeof ts_module }) {
    return {
        create(info: ts.server.PluginCreateInfo) {
            return new TSLintPlugin(typescript, info).decorate(info.languageService);
        },
    };
};
