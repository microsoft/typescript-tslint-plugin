import * as ts_module from 'typescript/lib/tsserverlibrary';

import { pluginId } from './config';

export class Logger {
    public static forPlugin(info: ts_module.server.PluginCreateInfo) {
        return new Logger(info.project.projectService.logger);
    }

    private constructor(
        private readonly _logger: ts_module.server.Logger
    ) { }

    public info(message: string) {
        this._logger.info(`[${pluginId}] ${JSON.stringify(message)}`);
    }
}