const test = require('node:test');
const assert = require('node:assert/strict');

const { buildEligibleRoomRecords, buildHotelRecord } = require('../src/hotel-record');

function createTemplate() {
  return {
    ctrip_url:
      'https://hotels.ctrip.com/hotels/detail/?hotelId=113036836&checkIn=2026-04-30&checkOut=2026-05-04&adult=3&children=0',
    check_in_date: '2026-04-30',
    check_out_date: '2026-05-04',
    room_count: 3,
    destination: '江汉路步行街',
    notes: ''
  };
}

function createMatchedTemplate() {
  return {
    id: 1776092721160,
    name: '武汉',
    destination: '江汉路步行街',
    check_in_date: '2026-04-30',
    check_out_date: '2026-05-04',
    room_count: 3
  };
}

function createTransit() {
  return {
    route: {
      distanceKm: 12.8,
      durationMinutes: 45,
      busRoute: '步行653米\n乘坐轨道交通5号线'
    },
    nearestSubway: {
      name: '张家湾地铁站',
      distanceKm: 0.5
    }
  };
}

function createStructuredRoom(overrides = {}) {
  return {
    title: '主题家庭房（坐卧长沙发+智能马桶）',
    standard_title: '家庭房',
    original_title: '主题家庭房（坐卧长沙发+智能马桶）',
    occupancy: 3,
    price: 564,
    total_price: 2255,
    cancelPolicy: '入住当天18:00前可免费取消',
    windowStatus: '有窗',
    raw: JSON.stringify({
      physicalRoom: {
        faciltityInfo: {
          qualityFacilityIds: [264, 310, 311, 107, 79, 92, 253, 77, 208, 240, 80, 261, 606],
          list: [
            {
              title: '网络与通讯',
              subList: [
                { id: 264, title: '客房WIFI', isNormalShow: 1 },
                { id: 261, title: '电话', isNormalShow: 1 }
              ]
            },
            {
              title: '媒体科技',
              subList: [{ id: 310, title: '智能门锁', isNormalShow: 1 }]
            },
            {
              title: '卫浴设施',
              subList: [
                { id: 311, title: '智能马桶', isNormalShow: 1 },
                { id: 92, title: '私人浴室', isNormalShow: 1 },
                { id: 79, title: '24小时热水', isNormalShow: 1 }
              ]
            },
            {
              title: '客房布局和家具',
              subList: [
                { id: 253, title: '沙发', isNormalShow: 1 },
                { id: 77, title: '书桌', isNormalShow: 1 },
                { id: 208, title: '衣柜/衣橱', isNormalShow: 1 }
              ]
            },
            {
              title: '室外景观',
              subList: [{ id: 240, title: '城景', isNormalShow: 1 }]
            },
            {
              title: '食品饮品',
              subList: [{ id: 80, title: '电热水壶', isNormalShow: 1 }]
            },
            {
              title: '清洁服务',
              subList: [{ id: 606, title: '每日打扫', isNormalShow: 1 }]
            },
            {
              title: '洗浴用品',
              subList: [{ id: 446, title: '牙刷', isNormalShow: 1 }]
            }
          ]
        },
        bedInfo: {
          title: '1张单人床 及 1张大床',
          cpxBedInfo: {
            bedDetail: [
              {
                roomName: '卧室1',
                detail: ['1张单人床（1.2米宽）和1张大床（1.8米宽）']
              }
            ]
          }
        },
        areaInfo: {
          title: '37–41平方米'
        },
        physicalFacilityList: [
          { title: 'Wi-Fi免费', isHighLight: true },
          { title: '37–41平方米 | 3-7层' }
        ]
      },
      saleRoom: {
        mealInfo: {
          title: '无早餐',
          hover: ['无早餐']
        },
        availParam: {
          extendParam: JSON.stringify({
            mealDesc: '加餐信息：西式、中式自助餐¥38每份'
          })
        },
        priceInfo: {
          taxText: '每晚需另付税费及服务费'
        }
      }
    }),
    ...overrides
  };
}

test('buildHotelRecord fills room area and notes from structured room data', () => {
  const record = buildHotelRecord(
    createTemplate(),
    {
      hotel_name: '武汉白沙洲大道万达悦华酒店',
      address: '湖北省武汉市洪山区张家湾街道烽火崇文兰庭武梁路',
      ctrip_score: 4.7,
      room: createStructuredRoom(),
      page_snapshot: {
        sources: []
      }
    },
    createTransit(),
    createMatchedTemplate()
  );

  assert.equal(record.room_area, '37');
  assert.match(record.notes, /床型：1张单人床（1.2米宽）和1张大床（1.8米宽）/);
  assert.match(record.notes, /早餐：无早餐/);
  assert.match(record.notes, /¥38\/份/);
  assert.doesNotMatch(record.notes, /税费|服务费/);
  assert.doesNotMatch(record.notes, /在线付|担保/);
  assert.doesNotMatch(record.notes, /张家湾地铁站/);
  assert.doesNotMatch(record.notes, /主题家庭房/);
});

test('buildHotelRecord keeps warning notes when the selected room price stays locked', () => {
  const record = buildHotelRecord(
    createTemplate(),
    {
      hotel_name: '武汉白沙洲大道万达悦华酒店',
      address: '湖北省武汉市洪山区张家湾街道烽火崇文兰庭武梁路',
      ctrip_score: 4.7,
      room: createStructuredRoom({
        price: null,
        total_price: null,
        price_locked: true
      }),
      page_snapshot: {
        selected_room_price_locked: true,
        sources: [
          {
            spider_error_codes: [203]
          }
        ]
      }
    },
    createTransit(),
    createMatchedTemplate()
  );

  assert.match(record.notes, /床型：1张单人床（1.2米宽）和1张大床（1.8米宽）/);
  assert.match(record.notes, /警告/);
  assert.match(record.notes, /203/);
});

test('buildEligibleRoomRecords returns empty array when no eligible rooms pass filtering', () => {
  const records = buildEligibleRoomRecords(
    createTemplate(),
    {
      hotel_name: '汉庭酒店（武昌火车站地铁站店）',
      address: '湖北武汉武昌区中山路633号万金国际广场2号楼1楼',
      ctrip_score: 4.6,
      room: {
        title: '高级大床房',
        standard_title: '大床房',
        original_title: '高级大床房',
        occupancy: 2,
        price: 455,
        total_price: 1818.9,
        price_locked: false
      },
      eligible_rooms: []
    },
    createTransit(),
    createMatchedTemplate()
  );

  assert.deepEqual(records, []);
});

test('buildEligibleRoomRecords keeps a 4-person room count when a 3-person template includes 4-person rooms', () => {
  const records = buildEligibleRoomRecords(
    createTemplate(),
    {
      hotel_name: '亲子酒店',
      address: '武汉测试地址',
      ctrip_score: 4.8,
      eligible_rooms: [
        createStructuredRoom({
          title: '亲子家庭房',
          standard_title: '家庭房',
          original_title: '亲子家庭房',
          occupancy: 4,
          price: 699,
          total_price: 2796
        })
      ]
    },
    createTransit(),
    createMatchedTemplate()
  );

  assert.equal(records.length, 1);
  assert.equal(records[0].room_count, 4);
  assert.equal(records[0].room_type, '家庭房');
});
