/* Merging hero grids by name (src/grid-config.ts, renderer/grids/merge-grids.ts).
 *
 * What a merge means was the one thing the grid feature had no test for, and it is the thing
 * that decides what a user's file looks like afterwards: two configs with the same config_name
 * are one grid, and the earlier one wins. Nothing inside a surviving config is rewritten or
 * combined - which is what makes the merge safe to run over a file the game is reading.
 *
 * Both halves are here because they must agree: the window previews the merge with the renderer
 * rule, and the main process writes it with src/grid-config.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { configName, dedupeConfigsByName, mergeGridFiles, mergeIntoGridConfig, parseGridFileContent } from '../src/grid-config.ts';
import { mergeSources, readGridFile, buildMergedGrid, type MergeSource } from '../renderer/grids/merge-grids.ts';

const cat = (name: string, x = 0, y = 0) => ({ category_name: name, x_position: x, y_position: y, width: 100, height: 60, hero_ids: [] as number[] });
const cfg = (name: string, categories: ReturnType<typeof cat>[]) => ({ config_name: name, categories });

test('a config is identified by its trimmed name, case folded', () => {
  assert.equal(configName({ config_name: '  boobs  ' }), 'boobs');
  assert.equal(configName({}), '');
  assert.equal(configName(null), '');
});

test('two configs with the same name are one grid, and the first survives', () => {
  const { configs, dropped } = dedupeConfigsByName([
    cfg('boobs', [cat('a')]),
    cfg('Су4ка', [cat('b')]),
    cfg('boobs', [cat('c')]),
  ]);
  assert.deepEqual(configs.map((c) => c.config_name), ['boobs', 'Су4ка']);
  assert.deepEqual(configs[0].categories, [cat('a')], 'the first copy is kept whole');
  assert.equal(dropped, 1);
});

test('a name that differs only by case or spacing is the same grid', () => {
  const { configs, dropped } = dedupeConfigsByName([
    cfg('Boobs', [cat('a')]),
    cfg('  boobs ', [cat('b')]),
    cfg('BOOBS', [cat('c')]),
  ]);
  assert.equal(configs.length, 1);
  assert.equal(configs[0].config_name, 'Boobs', 'the name is kept as the first file wrote it');
  assert.equal(dropped, 2);
});

test('nothing inside a surviving config is rewritten', () => {
  const original = { config_name: 'boobs', version: 7, categories: [cat('a')], extra: { keep: true } };
  const { configs } = dedupeConfigsByName([original, cfg('boobs', [cat('z')])]);
  assert.equal(configs[0].version, 7);
  assert.deepEqual(configs[0].extra, { keep: true });
  assert.deepEqual(configs[0].categories, [cat('a')]);
});

test('merging several files is the union of their configs, one per name', () => {
  const { configs, dropped } = mergeGridFiles([
    { version: 3, configs: [cfg('boobs', [cat('a')]), cfg('Су4ка', [cat('b')])] },
    { version: 3, configs: [cfg('boobs', [cat('c')]), cfg('18-', [cat('d')])] },
  ]);
  assert.deepEqual(configs.map((c) => c.config_name), ['boobs', 'Су4ка', '18-']);
  assert.deepEqual(dropped, ['boobs']);
});

test('merging into the game keeps a name the game already has', () => {
  const existing = { version: 3, configs: [cfg('boobs', [cat('in-game')])] };
  const { configs, dropped } = mergeIntoGridConfig(existing, [cfg('boobs', [cat('incoming')]), cfg('new', [cat('n')])]);
  assert.deepEqual(configs.map((c) => c.config_name), ['boobs', 'new']);
  assert.deepEqual(configs[0].categories, [cat('in-game')], 'the game\'s own copy wins its name');
  assert.deepEqual(dropped, ['boobs']);
});

test('a config with no name gets one instead of colliding with every other nameless one', () => {
  const { configs } = dedupeConfigsByName([{ categories: [cat('a')] }, { categories: [cat('b')] }]);
  assert.deepEqual(configs.map((c) => c.config_name), ['Сетка 1', 'Сетка 2']);
});

test('the window previews the same rule the main process writes', () => {
  const sources: MergeSource[] = [
    { name: 'boobs', categories: [cat('a')], origin: 'one.json' },
    { name: 'Су4ка', categories: [cat('b')], origin: 'one.json' },
    { name: 'boobs', categories: [cat('c')], origin: 'two.json' },
  ];
  const { configs, duplicates } = mergeSources(sources);
  const { configs: written } = dedupeConfigsByName(sources.map((s) => cfg(s.name, s.categories)));

  assert.deepEqual(configs.map((c) => c.config_name), written.map((c) => c.config_name));
  assert.deepEqual(configs.map((c) => c.categories), written.map((c) => c.categories));
  assert.deepEqual(duplicates, ['boobs']);
});

test('a bare config, an array and a {configs} file all read the same', () => {
  const bare = { config_name: 'boobs', categories: [cat('a')] };
  assert.deepEqual(readGridFile(bare, 'file'), [{ name: 'boobs', categories: [cat('a')], origin: 'file' }]);
  assert.deepEqual(readGridFile([bare], 'file'), [{ name: 'boobs', categories: [cat('a')], origin: 'file' }]);
  assert.deepEqual(readGridFile({ version: 3, configs: [bare] }, 'file'), [{ name: 'boobs', categories: [cat('a')], origin: 'file' }]);
});

test('a file that is not a grid reads as nothing', () => {
  assert.deepEqual(readGridFile({ hello: 'world' }, 'file'), []);
  assert.deepEqual(readGridFile(null, 'file'), []);
  assert.deepEqual(readGridFile({ config_name: 'empty', categories: [] }, 'file'), [], 'a config with no categories is not a grid');
});

test('the merged file keeps the picked order and every category of the survivors', () => {
  const { grid } = buildMergedGrid([
    { name: 'first', categories: [cat('a'), cat('b')], origin: 'x' },
    { name: 'second', categories: [cat('c')], origin: 'x' },
  ]);
  assert.deepEqual(grid.configs.map((c) => c.config_name), ['first', 'second']);
  assert.deepEqual(grid.configs[0].categories, [cat('a'), cat('b')]);
});

test('the main process reads a file the window wrote, grid for grid', () => {
  // the round trip the feature actually depends on: what the modal builds is what the channel saves
  const { grid } = buildMergedGrid([{ name: 'boobs', categories: [cat('a')], origin: 'x' }]);
  const parsed = parseGridFileContent(JSON.stringify(grid));
  assert.deepEqual(parsed?.configs?.map((c) => (c as { config_name: string }).config_name), ['boobs']);
});