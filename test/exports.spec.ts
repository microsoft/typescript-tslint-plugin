import * as test from 'tape';
import plugin = require( '../src/index');

test('should export a factory function', t => {
  t.equal(typeof plugin, 'function');
  t.end();
});