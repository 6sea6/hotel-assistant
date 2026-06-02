const { idsEqual } = require('../../shared/id-utils');

/**
 * @typedef {import('../repositories/hotel-repository').HotelRepository} HotelRepository
 * @typedef {import('../../shared/contracts').NormalizedTemplateRecord} NormalizedTemplateRecord
 */

/**
 * @param {NormalizedTemplateRecord} template
 * @returns {{id: import('../../shared/contracts').EntityId, name: string, destination: string, check_in_date: string|null, check_out_date: string|null, room_count: number|null}}
 */
function buildTemplateInfo(template) {
  return {
    id: template.id,
    name: template.name,
    destination: template.destination,
    check_in_date: template.check_in_date,
    check_out_date: template.check_out_date,
    room_count: template.room_count
  };
}

/**
 * @param {{hotelRepo: HotelRepository, templateId: import('../../shared/contracts').EntityId}} options
 * @returns {{affectedHotelCount: number, affectedHotels: import('../../shared/contracts').NormalizedHotelRecord[]}}
 */
function clearTemplateFromHotels({ hotelRepo, templateId }) {
  const hotels = hotelRepo.getAll();
  const affectedHotels = [];
  const updatedAt = new Date().toISOString();

  for (const hotel of hotels) {
    if (
      !idsEqual(hotel.template_id, templateId) &&
      !idsEqual(hotel.template_info?.id, templateId)
    ) {
      continue;
    }

    affectedHotels.push(
      hotelRepo.normalize(
        {
          ...hotel,
          template_id: null,
          template_info: null,
          updated_at: updatedAt
        },
        hotel
      )
    );
  }

  if (affectedHotels.length > 0) {
    hotelRepo.updateMany(affectedHotels);
  }

  return {
    affectedHotelCount: affectedHotels.length,
    affectedHotels
  };
}

/**
 * @param {{hotelRepo: HotelRepository, template: NormalizedTemplateRecord}} options
 * @returns {{affectedCount: number, affectedHotels: import('../../shared/contracts').NormalizedHotelRecord[]}}
 */
function syncTemplateToHotels({ hotelRepo, template }) {
  const hotels = hotelRepo.getAll();
  const templateInfo = buildTemplateInfo(template);
  const affectedHotels = [];
  const updatedAt = new Date().toISOString();

  for (const hotel of hotels) {
    if (hotel.template_id == null || !idsEqual(hotel.template_id, template.id)) {
      continue;
    }

    affectedHotels.push(
      hotelRepo.normalize(
        {
          ...hotel,
          template_id: template.id,
          template_info: templateInfo,
          destination: template.destination,
          check_in_date: template.check_in_date,
          check_out_date: template.check_out_date,
          room_count: template.room_count,
          updated_at: updatedAt
        },
        hotel
      )
    );
  }

  if (affectedHotels.length > 0) {
    hotelRepo.updateMany(affectedHotels);
  }

  return {
    affectedCount: affectedHotels.length,
    affectedHotels
  };
}

module.exports = {
  buildTemplateInfo,
  clearTemplateFromHotels,
  syncTemplateToHotels
};
