import { TSLintPlugin } from 'plugin';
import * as ts_module from '../node_modules/typescript/lib/tsserverlibrary';


export = function init(modules: { typescript: typeof ts_module }) {
    const ts = modules.typescript;

    return {
        create(info: ts.server.PluginCreateInfo) {
            return new TSLintPlugin(ts, info);
        }
    };
  
}
