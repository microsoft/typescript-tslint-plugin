// @ts-check

const assert = require('chai').assert;

/**
 * @param {{ start: { line: number, offset: number }, end: { line: number, offset: number }}} span
 * @param {{ line: number, offset: number }} start
 * @param {{ line: number, offset: number }} end
 */
function assertSpan(span, start, end) {
    assertPosition(span.start, start.line, start.offset);
    assertPosition(span.end, end.line, end.offset);
};

/**
 * @param {{ line: number, offset: number }} pos
 * @param {number} line 
 * @param {number} offset
 */
function assertPosition(pos, line, offset) {
    assert.strictEqual(pos.line, line);
    assert.strictEqual(pos.offset, offset);
};

module.exports = {
    assertPosition,
    assertSpan
};