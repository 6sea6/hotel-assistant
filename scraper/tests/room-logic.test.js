const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildRoomSelectionDiagnostics,
  deriveStandardRoomType,
  normalizeRoomCandidate,
  selectBestRoom,
  selectMatchingRooms
} = require('../src/scraper/room-logic');

test('deriveStandardRoomType treats big bed plus sofa bed as family room', () => {
  const room = {
    title: '欢友家庭房-配亲子沙发床',
    text: JSON.stringify({
      physicalRoom: {
        bedInfo: {
          title: '1张大床 + 1张沙发床'
        }
      }
    })
  };

  assert.equal(deriveStandardRoomType(room), '家庭房');
});

test('normalizeRoomCandidate keeps original title and standardizes sofa-bed family room', () => {
  const candidate = normalizeRoomCandidate({
    title: '欢友家庭房-配亲子沙发床',
    text: JSON.stringify({
      physicalRoom: {
        bedInfo: {
          title: '1张大床 + 1张沙发床'
        }
      }
    })
  });

  assert.equal(candidate.standard_title, '家庭房');
  assert.equal(candidate.original_title, '欢友家庭房-配亲子沙发床');
});

test('deriveStandardRoomType counts sofa bed as single bed in twin-style rooms', () => {
  const room = {
    title: '亲子双床房',
    text: JSON.stringify({
      physicalRoom: {
        bedInfo: {
          title: '2张沙发床'
        }
      }
    })
  };

  assert.equal(deriveStandardRoomType(room), '双床房');
});

test('deriveStandardRoomType keeps single double bed under king-bed title as big-bed room', () => {
  const room = {
    title: '雅致大床房',
    text: JSON.stringify({
      physicalRoom: {
        bedInfo: {
          title: '1张1.5米双人床'
        },
        houseTypeInfo: {
          bedCount: 1
        }
      }
    })
  };

  assert.equal(deriveStandardRoomType(room), '大床房');
});

test('deriveStandardRoomType still treats two double beds as twin room', () => {
  const room = {
    title: '豪华双床房',
    text: JSON.stringify({
      physicalRoom: {
        bedInfo: {
          title: '2张1.35米双人床'
        },
        houseTypeInfo: {
          bedCount: 2
        }
      }
    })
  };

  assert.equal(deriveStandardRoomType(room), '双床房');
});

test('deriveStandardRoomType treats two king-size beds as twin room', () => {
  const room = {
    title: '马哥孛罗套房',
    text: JSON.stringify({
      physicalRoom: {
        bedInfo: {
          title: '2张2米特大床'
        },
        houseTypeInfo: {
          bedCount: 2
        }
      }
    })
  };

  assert.equal(deriveStandardRoomType(room), '双床房');
});

test('deriveStandardRoomType treats big-bed versus single double-bed alternatives as big-bed room', () => {
  const room = {
    title: '智能豪华大床房',
    text: JSON.stringify({
      physicalRoom: {
        bedInfo: {
          title: '1张大床 或 1张双人床'
        },
        houseTypeInfo: {
          bedCount: 1
        }
      }
    })
  };

  assert.equal(deriveStandardRoomType(room), '大床房');
});

test('selectMatchingRooms keeps occupancy exact by default and can optionally include 4-person rooms for 3-person templates', () => {
  const roomBlocks = [
    {
      title: '标准家庭房',
      standard_title: '家庭房',
      original_title: '标准家庭房',
      occupancy: 3,
      price: 530,
      price_locked: false,
      windowStatus: '有窗',
      cancelPolicy: '入住当天18:00前可免费取消'
    },
    {
      title: '亲子家庭房',
      standard_title: '家庭房',
      original_title: '亲子家庭房',
      occupancy: 4,
      price: 560,
      price_locked: false,
      windowStatus: '有窗',
      cancelPolicy: '入住当天18:00前可免费取消'
    },
    {
      title: '豪华套房',
      standard_title: '家庭房',
      original_title: '豪华套房',
      occupancy: 5,
      price: 620,
      price_locked: false,
      windowStatus: '有窗',
      cancelPolicy: '入住当天18:00前可免费取消'
    }
  ];
  const template = {
    room_count: 3,
    room_type: ''
  };

  const strictRooms = selectMatchingRooms(roomBlocks, template);
  const relaxedRooms = selectMatchingRooms(roomBlocks, template, {
    includeFourPersonRoomsForThreePersonTemplate: true
  });

  assert.deepEqual(
    strictRooms.map((room) => room.occupancy),
    [3]
  );
  assert.deepEqual(
    relaxedRooms.map((room) => room.occupancy),
    [3, 4]
  );
});

test('selectMatchingRooms allows 2-person big-bed rooms for 1-person templates only', () => {
  const roomBlocks = [
    {
      title: '单人入住特惠房',
      standard_title: '双床房',
      original_title: '单人入住特惠房',
      occupancy: 1,
      price: 180,
      price_locked: false,
      windowStatus: '有窗',
      cancelPolicy: '免费取消'
    },
    {
      title: '舒适大床房',
      standard_title: '大床房',
      original_title: '舒适大床房',
      occupancy: 2,
      price: 220,
      price_locked: false,
      windowStatus: '有窗',
      cancelPolicy: '免费取消'
    },
    {
      title: '舒适双床房',
      standard_title: '双床房',
      original_title: '舒适双床房',
      occupancy: 2,
      price: 210,
      price_locked: false,
      windowStatus: '有窗',
      cancelPolicy: '免费取消'
    },
    {
      title: '亲子家庭房',
      standard_title: '家庭房',
      original_title: '亲子家庭房',
      occupancy: 2,
      price: 260,
      price_locked: false,
      windowStatus: '有窗',
      cancelPolicy: '免费取消'
    }
  ];

  const rooms = selectMatchingRooms(roomBlocks, {
    room_count: 1,
    room_type: ''
  });

  assert.deepEqual(
    rooms.map((room) => room.title),
    ['单人入住特惠房', '舒适大床房']
  );
});

test('selectBestRoom applies the same 1-person occupancy relaxation as eligible rooms', () => {
  const roomBlocks = [
    {
      title: '舒适双床房',
      standard_title: '双床房',
      original_title: '舒适双床房',
      occupancy: 2,
      price: 180,
      price_locked: false,
      windowStatus: '有窗',
      cancelPolicy: '免费取消'
    },
    {
      title: '舒适大床房',
      standard_title: '大床房',
      original_title: '舒适大床房',
      occupancy: 2,
      price: 220,
      price_locked: false,
      windowStatus: '有窗',
      cancelPolicy: '免费取消'
    }
  ];

  const room = selectBestRoom(roomBlocks, {
    room_count: 1,
    room_type: ''
  });

  assert.equal(room.title, '舒适大床房');
});

test('selectMatchingRooms normalizes template room count aliases before applying relaxation', () => {
  const roomBlocks = [
    {
      title: '单人入住特惠房',
      standard_title: '大床房',
      original_title: '单人入住特惠房',
      occupancy: 1,
      price: 180,
      price_locked: false,
      windowStatus: '有窗',
      cancelPolicy: '免费取消'
    },
    {
      title: '舒适大床房',
      standard_title: '大床房',
      original_title: '舒适大床房',
      occupancy: 2,
      price: 220,
      price_locked: false,
      windowStatus: '有窗',
      cancelPolicy: '免费取消'
    }
  ];

  const rooms = selectMatchingRooms(roomBlocks, {
    roomCount: 2,
    room_type: ''
  });

  assert.deepEqual(
    rooms.map((room) => room.title),
    ['舒适大床房']
  );
});

test('selectMatchingRooms skips non-cancellable and restricted-free-cancellation room variants', () => {
  const roomBlocks = [
    {
      title: '豪华江景套房',
      standard_title: '大床房',
      original_title: '豪华江景套房',
      occupancy: 3,
      price: 1570,
      total_price: 7848,
      price_locked: false,
      windowStatus: '有窗',
      cancelPolicy: '入住当天18:00前可免费取消'
    },
    {
      title: '豪华江景套房',
      standard_title: '大床房',
      original_title: '豪华江景套房',
      occupancy: 3,
      price: 1632,
      total_price: 8156,
      price_locked: false,
      windowStatus: '有窗',
      cancelPolicy: '不可取消'
    },
    {
      title: '豪华江景套房',
      standard_title: '大床房',
      original_title: '豪华江景套房',
      occupancy: 3,
      price: 1600,
      total_price: 8000,
      price_locked: false,
      windowStatus: '有窗',
      cancelPolicy: '订单确认后30分钟内可免费取消'
    }
  ];
  const template = {
    room_count: 3,
    room_type: '大床房'
  };

  const rooms = selectMatchingRooms(roomBlocks, template);

  assert.equal(rooms.length, 1);
  assert.equal(rooms[0].price, 1570);
  assert.equal(rooms[0].cancelPolicy, '入住当天18:00前可免费取消');
});

test('buildRoomSelectionDiagnostics records rejected and deduped room reasons', () => {
  const roomBlocks = [
    {
      title: '无价房',
      standard_title: '大床房',
      original_title: '无价房',
      occupancy: 3,
      price: null,
      price_locked: false,
      windowStatus: '有窗',
      cancelPolicy: '免费取消'
    },
    {
      title: '人数不足',
      standard_title: '大床房',
      original_title: '人数不足',
      occupancy: 2,
      price: 300,
      price_locked: false,
      windowStatus: '有窗',
      cancelPolicy: '免费取消'
    },
    {
      title: '可住房',
      standard_title: '大床房',
      original_title: '可住房',
      occupancy: 3,
      price: 400,
      price_locked: false,
      windowStatus: '有窗',
      cancelPolicy: '免费取消'
    },
    {
      title: '可住房',
      standard_title: '大床房',
      original_title: '可住房',
      occupancy: 3,
      price: 400,
      price_locked: false,
      windowStatus: '有窗',
      cancelPolicy: '免费取消'
    }
  ];

  const diagnostics = buildRoomSelectionDiagnostics(roomBlocks, {
    room_count: 3,
    room_type: '大床房'
  });

  assert.equal(diagnostics.eligibleRooms.length, 1);
  assert.deepEqual(
    diagnostics.selectionLogs.map((item) => item.reasonCode),
    ['price_missing_or_locked', 'occupancy_mismatch', 'selected', 'duplicate_room']
  );
  assert.equal(diagnostics.selectionLogs[3].action, 'deduped');
});
