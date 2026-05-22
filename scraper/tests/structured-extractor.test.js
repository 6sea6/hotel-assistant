const test = require('node:test');
const assert = require('node:assert/strict');

const { collectRoomCandidatesFromPayload } = require('../src/scraper/structured-extractor');

test('collectRoomCandidatesFromPayload keeps priced saleRoomMap entries even when roomList omits them', () => {
  const payload = {
    roomList: [],
    compensatedRooms: {
      roomList: []
    },
    physicRoomMap: {
      47852757: {
        id: 47852757,
        name: '高级双床间',
        faciltityInfo: {
          list: [{ title: '网络与通讯' }]
        },
        bedInfo: {
          title: '1张双人床 及 1张单人床'
        },
        areaInfo: {
          title: '28-30平方米'
        },
        windowInfo: {
          title: '有窗'
        },
        houseTypeInfo: {
          bedCount: 2
        },
        physicalFacilityList: [{ title: 'Wi-Fi免费' }],
        wifiInfo: {
          title: 'Wi-Fi免费'
        }
      }
    },
    saleRoomMap: {
      '94519069_BJMU2O': {
        id: 94519069,
        physicalRoomId: 47852757,
        bookingStatusInfo: {
          isHidePrice: false
        },
        guestCountInfo: {
          guestCount: 3
        },
        cancelInfo: {
          title: '入住当天18:00前可免费取消'
        },
        priceInfo: {
          price: 585,
          displayPrice: '¥585'
        },
        totalPriceInfo: {
          total: {
            content: '¥2338.28'
          }
        },
        tagInfoList: [{ tagTitle: '1张双人床 及 1张单人床' }, { tagTitle: '3人入住' }]
      }
    }
  };

  const rooms = collectRoomCandidatesFromPayload(payload, { room_count: 3 });
  const advancedTwin = rooms.find((room) => room.title === '高级双床间');

  assert.ok(advancedTwin);
  assert.equal(advancedTwin.standard_title, '家庭房');
  assert.equal(advancedTwin.occupancy, 3);
  assert.equal(advancedTwin.price, 585);
  assert.equal(advancedTwin.total_price, 2338.28);
  assert.match(advancedTwin.raw, /bedInfo/);
  assert.doesNotMatch(advancedTwin.raw, /faciltityInfo|physicalFacilityList|wifiInfo/);
});

test('collectRoomCandidatesFromPayload still scans saleRoomMap when roomList field is missing entirely', () => {
  const payload = {
    physicRoomMap: {
      47852757: {
        id: 47852757,
        name: '高级双床间',
        bedInfo: {
          title: '1张双人床 及 1张单人床'
        },
        houseTypeInfo: {
          bedCount: 2
        }
      }
    },
    saleRoomMap: {
      '94519069_BJMU2O': {
        id: 94519069,
        physicalRoomId: 47852757,
        bookingStatusInfo: {
          isHidePrice: false
        },
        guestCountInfo: {
          guestCount: 3
        },
        priceInfo: {
          price: 585
        }
      }
    }
  };

  const rooms = collectRoomCandidatesFromPayload(payload, { room_count: 3 });
  const advancedTwin = rooms.find((room) => room.title === '高级双床间');

  assert.ok(advancedTwin);
  assert.equal(advancedTwin.occupancy, 3);
  assert.equal(advancedTwin.price, 585);
});

test('collectRoomCandidatesFromPayload skips unreferenced saleRoomMap entries that are explicitly hidden', () => {
  const payload = {
    physicRoomMap: {
      47852757: {
        id: 47852757,
        name: '隐藏房型'
      }
    },
    saleRoomMap: {
      hiddenRoom: {
        physicalRoomId: 47852757,
        isVisible: false,
        priceInfo: {
          price: 499
        }
      }
    }
  };

  const rooms = collectRoomCandidatesFromPayload(payload, { room_count: 3 });
  assert.equal(rooms.length, 0);
});

test('collectRoomCandidatesFromPayload skips folded subRoom entries even when roomList references them', () => {
  const payload = {
    roomList: [
      {
        key: '47852757',
        subRoomList: [
          {
            skey: 'visible_room',
            key: '47852757',
            roomToken: 'VISIBLE'
          }
        ]
      },
      {
        key: '47852758',
        subRoomList: [
          {
            skey: 'folded_room',
            key: '47852758',
            roomToken: 'FOLDED',
            isFold: 1
          }
        ]
      }
    ],
    physicRoomMap: {
      47852757: {
        id: 47852757,
        name: '可见套房',
        bedInfo: {
          title: '1张1.8米大床'
        },
        houseTypeInfo: {
          bedCount: 1
        }
      },
      47852758: {
        id: 47852758,
        name: '折叠家庭房',
        bedInfo: {
          title: '1张大床 及 1张单人床'
        },
        houseTypeInfo: {
          bedCount: 2
        }
      }
    },
    saleRoomMap: {
      visible_room: {
        id: 94519069,
        physicalRoomId: 47852757,
        bookingStatusInfo: {
          isHidePrice: false
        },
        guestCountInfo: {
          guestCount: 3
        },
        cancelInfo: {
          title: '入住当天18:00前可免费取消'
        },
        priceInfo: {
          price: 888
        }
      },
      folded_room: {
        id: 94519070,
        physicalRoomId: 47852758,
        bookingStatusInfo: {
          isHidePrice: false
        },
        guestCountInfo: {
          guestCount: 3
        },
        cancelInfo: {
          title: '入住当天18:00前可免费取消'
        },
        priceInfo: {
          price: 666
        }
      }
    }
  };

  const rooms = collectRoomCandidatesFromPayload(payload, { room_count: 3 });
  const titles = rooms.map((room) => room.title);

  assert.deepEqual([...new Set(titles)], ['可见套房']);
  assert.ok(rooms.every((room) => room.title === '可见套房'));
  assert.ok(rooms.every((room) => room.price === 888));
});

test('collectRoomCandidatesFromPayload keeps folded cancellable rate plans when roomList references them', () => {
  const payload = {
    roomList: [
      {
        key: '332453605',
        subRoomList: [
          {
            key: '332453605',
            skey: 'base_non_cancel',
            roomToken: 'BASE',
            sRoomId: 1
          },
          {
            key: '332453605',
            skey: 'folded_free_cancel',
            roomToken: 'FREE',
            sRoomId: 2
          }
        ]
      }
    ],
    physicRoomMap: {
      332453605: {
        id: 332453605,
        name: '舒适大床房',
        bedInfo: {
          title: '1张1.8米大床'
        },
        houseTypeInfo: {
          bedCount: 1
        },
        windowInfo: {
          title: '有窗'
        }
      }
    },
    saleRoomMap: {
      base_non_cancel: {
        id: 1,
        physicalRoomId: 332453605,
        isFoldStatus: false,
        bookingStatusInfo: {
          isBooking: true,
          isHidePrice: false
        },
        guestCountInfo: {
          guestCount: 2
        },
        cancelInfo: {
          title: '不可取消'
        },
        priceInfo: {
          price: 352
        }
      },
      folded_free_cancel: {
        id: 2,
        physicalRoomId: 332453605,
        isFoldStatus: true,
        bookingStatusInfo: {
          isBooking: true,
          isHidePrice: false
        },
        guestCountInfo: {
          guestCount: 2
        },
        cancelInfo: {
          title: '入住当天18:00前可免费取消'
        },
        priceInfo: {
          price: 369
        }
      }
    }
  };

  const rooms = collectRoomCandidatesFromPayload(payload, { room_count: 2 });

  assert.ok(
    rooms.some(
      (room) =>
        room.title === '舒适大床房' &&
        room.price === 369 &&
        room.cancelPolicy === '入住当天18:00前可免费取消'
    )
  );
});

test('collectRoomCandidatesFromPayload skips folded full-room rate plans', () => {
  const payload = {
    roomList: [
      {
        key: '544047306',
        subRoomList: [
          {
            key: '544047306',
            skey: 'folded_full_room',
            roomToken: 'FULL',
            sRoomId: 3
          }
        ]
      }
    ],
    physicRoomMap: {
      544047306: {
        id: 544047306,
        name: '纯净双床房',
        bedInfo: {
          title: '2张1.35米双人床'
        },
        houseTypeInfo: {
          bedCount: 2
        }
      }
    },
    saleRoomMap: {
      folded_full_room: {
        id: 3,
        physicalRoomId: 544047306,
        isFoldStatus: true,
        bookingStatusInfo: {
          isBooking: false,
          isFullRoom: true,
          isHidePrice: false
        },
        reserveInfo: {
          isFullRoom: true
        },
        guestCountInfo: {
          guestCount: 2
        },
        cancelInfo: {
          title: '入住当天18:00前可免费取消'
        },
        priceInfo: {
          price: 699
        }
      }
    }
  };

  const rooms = collectRoomCandidatesFromPayload(payload, { room_count: 2 });

  assert.equal(rooms.length, 0);
});
