import * as plugin from './ts_plugin';

function factory(mod: { typescript: any /*typeof  ts*/ }) {
  plugin.init(mod);
  return plugin;
};

factory['create'] = plugin.create;

export = factory;