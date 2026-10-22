import test from 'node:test';
import assert from 'node:assert/strict';
test('Verification-only required failure stops the source gate',()=>assert.fail('Intentional required-gate failure probe'));
