// A priced candidate alone does not prove that all sale rooms have arrived.
function isCompleteRoomPayload(payload) {
  const data = payload?.data;
  if (!data || Number(data.htlSpiderActionErrorCode) === 203 || data.isLogin === false)
    return false;
  if (data.hasMore === true || data.hasNext === true) return false;
  if (!Array.isArray(data.roomList) || !data.saleRoomMap || !data.physicRoomMap) return false;
  if (
    data.roomCount === 0 &&
    data.isRoomListSoldOut === true &&
    data.roomList.length === 0 &&
    Object.keys(data.saleRoomMap).length === 0
  )
    return true;
  const references = data.roomList.flatMap((room) =>
    Array.isArray(room.subRoomList) ? room.subRoomList : []
  );
  const keys = new Set(references.map((room) => room.skey).filter(Boolean));
  return (
    Number.isInteger(data.roomCount) &&
    data.roomCount > 0 &&
    keys.size === data.roomCount &&
    Object.keys(data.saleRoomMap).length === data.roomCount &&
    data.roomList.every((room) => Boolean(data.physicRoomMap[room.key])) &&
    references.every((room) => Boolean(data.saleRoomMap[room.skey]))
  );
}

module.exports = { isCompleteRoomPayload };
