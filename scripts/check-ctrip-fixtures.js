const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

async function main() {
  const project = path.resolve(__dirname, '..');
  process.env.NODE_PATH = path.join(project, 'node_modules');
  require('node:module').Module._initPaths();
  const baselineRoot = path.join(project, 'output/ctrip-benchmark-reference/src');
  const relative = 'scraper/edge-capture-modules/response-parser.js';
  fs.writeFileSync(
    path.join(baselineRoot, relative),
    execFileSync('git', ['show', `HEAD:scraper/src/${relative}`], { cwd: project })
  );
  const fixture = JSON.parse(
    fs.readFileSync(
      path.join(project, 'output/debug-final-425174-logged/425174-api-01.json'),
      'utf8'
    )
  );
  const payload = fixture.body;
  const url = 'https://m.ctrip.com/restapi/soa2/30103/getHotelRoomList';
  const results = [];
  for (const [label, root] of [
    ['reference', baselineRoot],
    ['current', path.join(project, 'scraper/src')]
  ]) {
    const debugPath = path.join(root, 'scraper/edge-capture-modules/debug.js');
    require.cache[debugPath] = {
      id: debugPath,
      filename: debugPath,
      loaded: true,
      exports: { writeEdgeDebugArtifact() {}, logEdgeDebug() {} }
    };
    const { parseEdgeNetworkResponses } = require(path.join(root, relative));
    const { mergeRoomCandidates, buildRoomSelectionDiagnostics } = require(
      path.join(root, 'scraper/room-logic.js')
    );
    const template = {
      room_type: '',
      room_count: 2,
      check_in_date: '2026-07-04',
      check_out_date: '2026-07-06',
      days: 2
    };
    const roomBlocks = [];
    const processedRequestIds = new Set();
    const requestMeta = new Map([
      [
        'first',
        {
          url,
          mimeType: 'application/json',
          cachedBodyResult: { body: JSON.stringify(payload), retryCount: 0, timeoutCount: 0 }
        }
      ]
    ]);
    const args = {
      connection: {
        send() {
          throw new Error('Fixture parsing must not access CDP');
        }
      },
      sessionId: 'local',
      requestMeta,
      template,
      roomBlocks,
      spiderErrorCodes: new Set(),
      debugHotelId: 'fixture',
      processedRequestIds
    };
    const stats = await parseEdgeNetworkResponses({ ...args, incremental: label === 'current' });
    const merged = mergeRoomCandidates(roomBlocks);
    const selected = buildRoomSelectionDiagnostics(merged, template).eligibleRooms;
    const summary = selected
      .map((room) => ({
        title: room.title,
        price: room.price,
        occupancy: room.occupancy,
        cancelPolicy: room.cancelPolicy
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    if (label === 'current') {
      const count = roomBlocks.length;
      await parseEdgeNetworkResponses(args);
      assert.equal(
        roomBlocks.length,
        count,
        'Incremental plus final parsing must not duplicate candidates'
      );
      assert.equal(stats.captureComplete, true);
    }
    results.push({
      label,
      extractedCount: merged.length,
      eligibleCount: selected.length,
      minimumPrice: Math.min(...selected.map((room) => room.price)),
      summary
    });
  }
  assert.deepEqual(results[0].summary, results[1].summary);
  const report = {
    generatedAt: new Date().toISOString(),
    fixture: 'existing local 425174 room response',
    equal: true,
    networkRequests: 0,
    results: results.map(({ summary: _summary, ...row }) => row)
  };
  fs.writeFileSync(
    path.join(project, 'output/ctrip-fixture-comparison.json'),
    JSON.stringify(report, null, 2)
  );
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
