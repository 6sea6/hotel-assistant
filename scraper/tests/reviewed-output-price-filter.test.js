const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const reviewedOutputPath = require.resolve('../src/cli/reviewed-output');
const bridgePath = require.resolve('../src/compare-app-bridge');
const hotelMergePath = require.resolve('../src/compare-app/hotel-merge');
const runSummaryPath = require.resolve('../src/cli/run-summary');

function installMock(modulePath, exports) {
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports
  };
}

function clearMocks() {
  for (const modulePath of [reviewedOutputPath, bridgePath, hotelMergePath, runSummaryPath]) {
    delete require.cache[modulePath];
  }
}

function writePayload(tempDir, payload) {
  const outputPath = path.join(tempDir, 'result.json');
  fs.writeFileSync(outputPath, JSON.stringify(payload), 'utf8');
  return outputPath;
}

test('reviewed output deletes the exact existing group when every room was price-filtered', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filtered-group-delete-'));
  const deletedReferences = [];
  try {
    clearMocks();
    installMock(bridgePath, {
      appendHotelsToStore() {
        throw new Error('append should not run');
      },
      getCompareAppStorePath: () => path.join(tempDir, 'hotel-data.json')
    });
    installMock(hotelMergePath, {
      removeHotelGroupsFromStore(reference) {
        deletedReferences.push(reference);
        return [{ operation: 'deleted-group', deletedCount: 2 }];
      }
    });
    installMock(runSummaryPath, {
      buildRunSummary: (value) => value,
      writeLatestRunFile() {}
    });

    const { applyReviewedOutput } = require(reviewedOutputPath);
    const reference = {
      name: '测试酒店',
      website: 'https://hotels.ctrip.com/hotels/123.html',
      template_id: 'tpl-1'
    };
    const outputPath = writePayload(tempDir, {
      hotels: [],
      post_filter: { removedCount: 2, keptCount: 0, perPersonDailyPriceMax: 150 },
      filtered_hotel_reference: reference
    });

    applyReviewedOutput(outputPath, path.join(tempDir, 'latest.json'), new Date().toISOString(), {
      deleteFilteredGroup: true
    });

    assert.deepEqual(deletedReferences, [reference]);
  } finally {
    clearMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('reviewed output overwrites the group when only some old rooms exceed the ceiling', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filtered-group-overwrite-'));
  const appendCalls = [];
  try {
    clearMocks();
    installMock(bridgePath, {
      appendHotelsToStore(hotels, options) {
        appendCalls.push({ hotels, options });
        return [{ operation: 'overwritten-group', count: hotels.length }];
      },
      getCompareAppStorePath: () => path.join(tempDir, 'hotel-data.json')
    });
    installMock(hotelMergePath, { removeHotelGroupsFromStore: () => [] });
    installMock(runSummaryPath, {
      buildRunSummary: (value) => value,
      writeLatestRunFile() {}
    });

    const { applyReviewedOutput } = require(reviewedOutputPath);
    const hotels = [
      {
        name: '测试酒店',
        website: 'https://hotels.ctrip.com/hotels/123.html',
        room_type: '大床房'
      }
    ];
    const outputPath = writePayload(tempDir, {
      hotels,
      hotel: hotels[0],
      post_filter: { removedCount: 1, keptCount: 1, perPersonDailyPriceMax: 150 }
    });

    applyReviewedOutput(outputPath, path.join(tempDir, 'latest.json'), new Date().toISOString());

    assert.equal(appendCalls.length, 1);
    assert.deepEqual(appendCalls[0].hotels, hotels);
    assert.equal(appendCalls[0].options.overwriteExistingGroup, true);
  } finally {
    clearMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
