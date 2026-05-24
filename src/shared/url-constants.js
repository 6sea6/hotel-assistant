const TRAILING_URL_PUNCTUATION = /[)\]}>，。；;、！？!?.,]+$/;
const INLINE_URL_TEXT_SEPARATOR = /[,，。；;、！？!?](?=[\u4e00-\u9fff])/;

module.exports = {
  TRAILING_URL_PUNCTUATION,
  INLINE_URL_TEXT_SEPARATOR
};
