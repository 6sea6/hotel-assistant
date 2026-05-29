const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let moduleUrl = '';

async function loadHelpers() {
  if (!moduleUrl) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-state-helpers-'));
    const sourceDir = path.join(__dirname, '..', 'src', 'renderer', 'modules');
    fs.writeFileSync(path.join(tempRoot, 'package.json'), '{"type":"module"}\n', 'utf-8');
    fs.copyFileSync(
      path.join(sourceDir, 'hotel-state-helpers.js'),
      path.join(tempRoot, 'hotel-state-helpers.js')
    );
    moduleUrl = pathToFileURL(path.join(tempRoot, 'hotel-state-helpers.js')).href;
    process.on('exit', () => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
  }
  return import(moduleUrl);
}

function makeHotel(id, name) {
  return { id, name, is_favorite: 0 };
}

test('appendHotelToList adds hotel to the end', async () => {
  const { appendHotelToList } = await loadHelpers();
  const hotels = [makeHotel(1, 'A'), makeHotel(2, 'B')];
  const result = appendHotelToList(hotels, makeHotel(3, 'C'));

  assert.equal(result.length, 3);
  assert.equal(result[2].name, 'C');
  assert.equal(hotels.length, 2);
});

test('replaceHotelInList replaces matching hotel by id', async () => {
  const { replaceHotelInList } = await loadHelpers();
  const hotels = [makeHotel(1, 'A'), makeHotel(2, 'B'), makeHotel(3, 'C')];
  const updated = { id: 2, name: 'B+', is_favorite: 1 };
  const { list, replaced } = replaceHotelInList(hotels, updated);

  assert.equal(replaced, true);
  assert.equal(list.length, 3);
  assert.equal(list[1].name, 'B+');
  assert.equal(list[1].is_favorite, 1);
  assert.equal(hotels[1].name, 'B');
});

test('replaceHotelInList handles string/number id mismatch', async () => {
  const { replaceHotelInList } = await loadHelpers();
  const hotels = [makeHotel(1, 'A'), makeHotel(2, 'B')];
  const updated = { id: '2', name: 'B+', is_favorite: 1 };
  const { list, replaced } = replaceHotelInList(hotels, updated);

  assert.equal(replaced, true);
  assert.equal(list[1].name, 'B+');
});

test('replaceHotelInList appends when id not found', async () => {
  const { replaceHotelInList } = await loadHelpers();
  const hotels = [makeHotel(1, 'A')];
  const updated = makeHotel(99, 'New');
  const { list, replaced } = replaceHotelInList(hotels, updated);

  assert.equal(replaced, false);
  assert.equal(list.length, 2);
  assert.equal(list[1].name, 'New');
});

test('replaceHotelInList uses fallbackId when updatedHotel.id is null', async () => {
  const { replaceHotelInList } = await loadHelpers();
  const hotels = [makeHotel(5, 'A')];
  const updated = { id: null, name: 'A+', is_favorite: 1 };
  const { list, replaced } = replaceHotelInList(hotels, updated, 5);

  assert.equal(replaced, true);
  assert.equal(list[0].name, 'A+');
});

test('removeHotelById removes matching hotel', async () => {
  const { removeHotelById } = await loadHelpers();
  const hotels = [makeHotel(1, 'A'), makeHotel(2, 'B'), makeHotel(3, 'C')];
  const { list, removed } = removeHotelById(hotels, 2);

  assert.equal(removed, true);
  assert.equal(list.length, 2);
  assert.equal(list[0].name, 'A');
  assert.equal(list[1].name, 'C');
  assert.equal(hotels.length, 3);
});

test('removeHotelById handles string/number id mismatch', async () => {
  const { removeHotelById } = await loadHelpers();
  const hotels = [makeHotel(1, 'A'), makeHotel(2, 'B')];
  const { list, removed } = removeHotelById(hotels, '2');

  assert.equal(removed, true);
  assert.equal(list.length, 1);
});

test('removeHotelById returns original array when id not found', async () => {
  const { removeHotelById } = await loadHelpers();
  const hotels = [makeHotel(1, 'A')];
  const { list, removed } = removeHotelById(hotels, 404);

  assert.equal(removed, false);
  assert.strictEqual(list, hotels);
});

test('findHotelIndexById returns correct index', async () => {
  const { findHotelIndexById } = await loadHelpers();
  const hotels = [makeHotel(10, 'X'), makeHotel(20, 'Y')];

  assert.equal(findHotelIndexById(hotels, 10), 0);
  assert.equal(findHotelIndexById(hotels, '20'), 1);
  assert.equal(findHotelIndexById(hotels, 99), -1);
});
