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
 * @returns {{affectedHotelCount: number}}
 */
function clearTemplateFromHotels({ hotelRepo, templateId }) {
  const hotels = hotelRepo.getAll();
  let affectedHotelCount = 0;
  const nextHotels = hotels.map((hotel) => {
    if (
      !idsEqual(hotel.template_id, templateId) &&
      !idsEqual(hotel.template_info?.id, templateId)
    ) {
      return hotel;
    }

    affectedHotelCount += 1;
    return hotelRepo.normalize(
      {
        ...hotel,
        template_id: null,
        template_info: null,
        updated_at: new Date().toISOString()
      },
      hotel
    );
  });

  if (affectedHotelCount > 0) {
    hotelRepo.replaceAll(nextHotels);
  }

  return { affectedHotelCount };
}

/**
 * @param {{hotelRepo: HotelRepository, template: NormalizedTemplateRecord}} options
 * @returns {{affectedCount: number}}
 */
function syncTemplateToHotels({ hotelRepo, template }) {
  const hotels = hotelRepo.getAll();
  const templateInfo = buildTemplateInfo(template);
  let affectedCount = 0;
  const nextHotels = hotels.map((hotel) => {
    if (hotel.template_id == null || !idsEqual(hotel.template_id, template.id)) {
      return hotel;
    }

    affectedCount += 1;
    return hotelRepo.normalize(
      {
        ...hotel,
        template_id: template.id,
        template_info: templateInfo,
        destination: template.destination,
        check_in_date: template.check_in_date,
        check_out_date: template.check_out_date,
        room_count: template.room_count,
        updated_at: new Date().toISOString()
      },
      hotel
    );
  });

  if (affectedCount > 0) {
    hotelRepo.replaceAll(nextHotels);
  }

  return { affectedCount };
}

module.exports = {
  buildTemplateInfo,
  clearTemplateFromHotels,
  syncTemplateToHotels
};
