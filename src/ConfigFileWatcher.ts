import * as ts_module from '../node_modules/typescript/lib/tsserverlibrary';

export class ConfigFileWatcher {
    private readonly _watchedConfigs = new Set<string>();

    public constructor(
        private readonly ts: typeof ts_module,
        private readonly onChange: (fileName: string) => void
    ) { }

    public ensureWatching(file: string) {
        if (!this.ts.sys.watchFile) {
            return;
        }
        if (this._watchedConfigs.has(file)) {
            return;
        }
        this._watchedConfigs.add(file);
        this.ts.sys.watchFile(file, (fileName: string, eventKind: ts.FileWatcherEventKind) => {
            if (eventKind === this.ts.FileWatcherEventKind.Changed) {
                this.onChange(fileName);
            }
        });
    }
}