import * as plugin from './ts_plugin';

function factory() {
  return plugin;
};

factory['create'] = plugin.create;

export = factory;
