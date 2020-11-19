import { TSLintPlugin } from './plugin';
import * as ts_module from 'typescript/lib/tsserverlibrary';
import { Logger } from './logger';
import { ConfigurationManager } from './settings';
import * as mockRequire from 'mock-require';
import { WorkspaceLibraryExecution } from './runner';

const enableWorkspaceLibraryExecutionEnvVar = 'TS_TSLINT_ENABLE_WORKSPACE_LIBRARY_EXECUTION';

export = function init({ typescript }: { typescript: typeof ts_module }) {
    const configManager = new ConfigurationManager(typescript);
    let logger: Logger | undefined;
    let plugin: TSLintPlugin | undefined;

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

            plugin = new TSLintPlugin(typescript, info.languageServiceHost, logger, info.project, configManager);

            // Allow clients that don't use onConfigurationChanged to still securely enable
            // workspace library execution with an env var.
            const workspaceLibraryFromEnv = process.env[enableWorkspaceLibraryExecutionEnvVar] ? WorkspaceLibraryExecution.Allow : WorkspaceLibraryExecution.Unknown;
            plugin.updateWorkspaceTrust(workspaceLibraryFromEnv);

            return plugin.decorate(info.languageService);
        },
        onConfigurationChanged(config: any) {
            if (logger) {
                logger.info('onConfigurationChanged');
            }

            if (plugin) {
                if ('allowWorkspaceLibraryExecution' in config) {
                    plugin.updateWorkspaceTrust(config.allowWorkspaceLibraryExecution ? WorkspaceLibraryExecution.Allow : WorkspaceLibraryExecution.Disallow);
                }
            }

            configManager.updateFromPluginConfig(config);
        },
    };
};

function isValidTypeScriptVersion(typescript: typeof ts_module): boolean {
    const [major] = typescript.version.split('.');
    return +major >= 3;
}
