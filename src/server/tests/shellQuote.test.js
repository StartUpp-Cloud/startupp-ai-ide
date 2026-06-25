import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shellSingleQuote } from '../codeIndex.js';

describe('shellSingleQuote', () => {
  it("wraps a plain filename in single quotes", () => {
    assert.equal(shellSingleQuote('a.js'), "'a.js'");
  });

  it("escapes embedded single quotes using the '\\'' pattern", () => {
    assert.equal(shellSingleQuote("a'b"), "'a'\\''b'");
  });

  it("handles multiple single quotes", () => {
    assert.equal(shellSingleQuote("a'b'c"), "'a'\\''b'\\''c'");
  });

  it("handles empty string", () => {
    assert.equal(shellSingleQuote(''), "''");
  });
});
