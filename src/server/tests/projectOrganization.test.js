import assert from 'node:assert/strict';
import {
  clientColor,
  groupProjectsByClient,
  moveClientGroup,
  moveProjectInClientGroup,
  nextSortOrder,
  normalizeClient,
  normalizeSortOrder,
} from '../projectOrganization.js';

assert.equal(normalizeClient('  Openava  '), 'Openava');
assert.equal(normalizeClient(''), '');
assert.equal(normalizeClient(null), '');
assert.equal(normalizeSortOrder('12', 0), 12);
assert.equal(normalizeSortOrder('nope', 7), 7);
assert.equal(nextSortOrder([]), 0);
assert.equal(nextSortOrder([{ sortOrder: 2 }, { sortOrder: 8 }]), 9);

const projects = [
  { id: 'a', name: 'Agency', client: 'Openava', sortOrder: 1 },
  { id: 'b', name: 'App', client: 'Openava', sortOrder: 2 },
  { id: 'c', name: 'Honeygrid', client: 'Honeygrid', sortOrder: 3 },
  { id: 'd', name: 'Loose', client: '  ', sortOrder: 4 },
];

const groups = groupProjectsByClient(projects);
assert.equal(groups.length, 3);
assert.deepEqual(groups.map((g) => g.client), ['Openava', 'Honeygrid', '']);
assert.deepEqual(groups[0].projects.map((p) => p.id), ['a', 'b']);

const sameClient = groupProjectsByClient([
  { id: 'x', name: 'One', client: 'Acme', sortOrder: 1 },
  { id: 'y', name: 'Two', client: 'Acme', sortOrder: 0 },
]);
assert.equal(sameClient.length, 1);
assert.deepEqual(sameClient[0].projects.map((p) => p.id), ['y', 'x']);

const differentCase = groupProjectsByClient([
  { id: 'x', name: 'One', client: 'Acme', sortOrder: 0 },
  { id: 'y', name: 'Two', client: 'acme', sortOrder: 1 },
]);
assert.equal(differentCase.length, 2, 'client grouping is exact-match, not case-folded');

const movedDown = moveProjectInClientGroup(projects, 'a', 'down');
assert.equal(movedDown.moved, true);
const openavaAfter = groupProjectsByClient(movedDown.projects).find((g) => g.client === 'Openava');
assert.deepEqual(openavaAfter.projects.map((p) => p.id), ['b', 'a']);

const blocked = moveProjectInClientGroup(projects, 'a', 'up');
assert.equal(blocked.moved, false);

const groupMoved = moveClientGroup(projects, 'Honeygrid', 'up');
assert.equal(groupMoved.moved, true);
assert.deepEqual(
  groupProjectsByClient(groupMoved.projects).map((g) => g.client),
  ['Honeygrid', 'Openava', ''],
);

const colorA = clientColor('Openava');
const colorB = clientColor('Honeygrid');
assert.ok(colorA.bar && colorA.text && colorA.bg);
assert.notEqual(colorA.bar, colorB.bar);
assert.equal(clientColor('Openava').bar, colorA.bar);
assert.equal(clientColor('').bar.includes('surface') || clientColor('').neutral, true);

console.log('projectOrganization tests passed');
