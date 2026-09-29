function toPositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function getPerPersonDailyPrice(hotel = {}) {
  const dailyPrice = toPositiveNumber(hotel.daily_price);
  const roomOccupancy = toPositiveNumber(hotel.room_count);
  if (dailyPrice === null || roomOccupancy === null) {
    return null;
  }

  return Number((dailyPrice / roomOccupancy).toFixed(2));
}

function getRawPerPersonDailyPrice(hotel = {}) {
  const dailyPrice = toPositiveNumber(hotel.daily_price);
  const roomOccupancy = toPositiveNumber(hotel.room_count);
  return dailyPrice === null || roomOccupancy === null ? null : dailyPrice / roomOccupancy;
}

function filterHotelsByPerPersonDailyPrice(hotels = [], maximum = null) {
  const normalizedHotels = Array.isArray(hotels) ? hotels : [];
  const normalizedMaximum = toPositiveNumber(maximum);
  if (normalizedMaximum === null) {
    return {
      active: false,
      maximum: null,
      hotels: normalizedHotels,
      keptIndexes: normalizedHotels.map((_hotel, index) => index),
      removed: []
    };
  }

  const keptHotels = [];
  const keptIndexes = [];
  const removed = [];
  normalizedHotels.forEach((hotel, index) => {
    const rawPerPersonDailyPrice = getRawPerPersonDailyPrice(hotel);
    const perPersonDailyPrice = getPerPersonDailyPrice(hotel);
    if (rawPerPersonDailyPrice !== null && rawPerPersonDailyPrice > normalizedMaximum) {
      removed.push({
        index,
        name: String(hotel.name || ''),
        roomType: String(hotel.room_type || ''),
        dailyPrice: Number(hotel.daily_price),
        roomOccupancy: Number(hotel.room_count),
        perPersonDailyPrice
      });
      return;
    }

    keptHotels.push(hotel);
    keptIndexes.push(index);
  });

  return {
    active: true,
    maximum: normalizedMaximum,
    hotels: keptHotels,
    keptIndexes,
    removed
  };
}

function summarizePriceFilter(result = {}) {
  return {
    active: Boolean(result.active),
    perPersonDailyPriceMax: result.maximum ?? null,
    removedCount: Array.isArray(result.removed) ? result.removed.length : 0,
    keptCount: Array.isArray(result.hotels) ? result.hotels.length : 0
  };
}

module.exports = {
  filterHotelsByPerPersonDailyPrice,
  getPerPersonDailyPrice,
  summarizePriceFilter
};
