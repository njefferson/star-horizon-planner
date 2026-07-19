// The migration banner must fire ONLY on the exact pre-rename origin — never
// on the new home, localhost/dev, previews, or lookalike hosts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { movedAway, OLD_HOST, NEW_ORIGIN } from '../src/ui/moved.js';

test('movedAway: true only on the old production host', () => {
  assert.equal(movedAway(OLD_HOST), true);
  assert.equal(movedAway('star-horizon-planner.pages.dev'), true);
});

test('movedAway: false everywhere else', () => {
  assert.equal(movedAway('clear-horizons.pages.dev'), false);
  assert.equal(movedAway('localhost'), false);
  assert.equal(movedAway('127.0.0.1'), false);
  // Preview deployments hang off the project subdomain — still not the old prod host.
  assert.equal(movedAway('abc123.star-horizon-planner.pages.dev'), false);
  assert.equal(movedAway(''), false);
  assert.equal(movedAway(undefined), false);
});

test('the new origin is the renamed home, https', () => {
  assert.equal(NEW_ORIGIN, 'https://clear-horizons.pages.dev');
});
