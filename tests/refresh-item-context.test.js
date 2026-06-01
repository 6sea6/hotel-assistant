const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createRefreshDetailContextFactory,
  mapRefreshPreparedResult
} = require('../src/main/ai/refresh-item-context');

function createTemplateDeps() {
  return {
    bridge: {
      findTemplateInStore(_store, templateId) {
        return {
          id: templateId,
          template_name: '实验模板',
          destination: '武汉',
          city: '武汉',
          check_in_date: '2026-06-17',
          check_out_date: '2026-06-18',
          adults: 1
        };
      }
    },
    store: { templates: [] },
    applyMatchedTemplate(loadedTemplate, matchedTemplate) {
      return {
        ...loadedTemplate,
        ...matchedTemplate,
        template_id: matchedTemplate.id
      };
    },
    mergeTemplateWithArgs(_template, collectArgs) {
      return {
        template_id: collectArgs.templateId,
        template_name: collectArgs.templateName,
        destination: '武汉'
      };
    },
    validateTemplate(template) {
      assert.equal(template.template_id, 'tpl-1');
    },
    normalizePlaceName(value) {
      return String(value || '').trim();
    },
    createScrapeEventForwarder(emit) {
      return (eventType, message, details) => emit(eventType, message, details);
    }
  };
}

test('refresh item context factory builds a no-write prepared detail context', async () => {
  const emitted = [];
  const url = 'https://hotels.ctrip.com/hotels/123.html';
  const hotelGroups = new Map([
    [
      url,
      [
        {
          id: 'hotel-1',
          name: '测试酒店',
          template_id: 'tpl-1'
        }
      ]
    ]
  ]);

  const createContext = createRefreshDetailContextFactory({
    input: { amapKey: 'amap-key' },
    taskContext: { taskId: 'refresh-task', signal: null },
    workDir: 'E:/tmp/hotel-work',
    hotelGroups,
    compareAppSettings: { includeFourPersonRoomsForThreePersonTemplate: true },
    baseEdgeUserDataDir: 'E:/tmp/edge-profile',
    baseEdgeProfileDirectory: 'Default',
    emit: (type, message, details) => emitted.push({ type, message, details }),
    ...createTemplateDeps()
  });

  const prepared = await createContext({
    url,
    index: 2,
    total: 3,
    hotelName: '测试酒店',
    worker: {
      port: 9555,
      userDataDir: 'E:/tmp/worker-2',
      profileDirectory: 'Profile 2'
    }
  });

  assert.equal(prepared.context.args.skipTransit, true);
  assert.equal(prepared.context.args['skip-report'], true);
  assert.equal(prepared.context.args['no-output-report'], true);
  assert.equal(prepared.context.args.captureStrategy, 'parallel_edge');
  assert.equal(prepared.context.args['auto-edge'], false);
  assert.equal(prepared.context.args['edge-debugging-port'], 9555);
  assert.equal(prepared.context.writeAppData, false);
  assert.equal(prepared.context.reportLevel, 'off');
  assert.equal(prepared.context.taskId, 'refresh-task-2');
  assert.equal(prepared.context.hotelInput.source, 'refresh');
  assert.equal(prepared.meta.refreshItem.firstHotel.name, '测试酒店');

  prepared.context.emit('transit:start', '不应转发');
  prepared.context.emit('scrape:start', '正在采集', { phase: 'scrape' });
  assert.deepEqual(emitted, [
    {
      type: 'scrape:start',
      message: '正在采集',
      details: {
        index: 2,
        total: 3,
        hotelName: '测试酒店',
        phase: 'scrape'
      }
    }
  ]);
});

test('refresh prepared result mapper preserves old room fields and counts deleted room types', async () => {
  const existingHotels = [
    {
      name: '旧酒店',
      room_type: '大床房',
      distance: '1.2',
      subway_station: '光谷广场',
      transport_time: '25',
      is_favorite: 1,
      notes: ''
    },
    {
      name: '旧酒店',
      room_type: '双床房',
      notes: '保留备注'
    }
  ];

  const result = await mapRefreshPreparedResult({
    preparedResult: {
      result: {
        success: true,
        eligibleCount: 1,
        eligibleHotels: [
          {
            name: '新酒店',
            room_type: '大床房',
            daily_price: '300'
          }
        ]
      }
    },
    url: 'https://hotels.ctrip.com/hotels/123.html',
    hotelName: '测试酒店',
    meta: {
      refreshItem: {
        existingHotels,
        firstHotel: existingHotels[0]
      }
    }
  });

  assert.equal(result.status, 'updated');
  assert.equal(result.updatedRoomTypeCount, 1);
  assert.equal(result.deletedRoomTypeCount, 1);
  assert.equal(result.updatedHotels[0].distance, '1.2');
  assert.equal(result.updatedHotels[0].subway_station, '光谷广场');
  assert.equal(result.updatedHotels[0].transport_time, '25');
  assert.equal(result.updatedHotels[0].is_favorite, 1);
  assert.equal(result.updatedHotels[0].notes, '');
});
