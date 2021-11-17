const dayjs = require('dayjs')
const { sampleSize } = require('lodash/collection')

function expiresIn (expirationTimestamp, now) {
  const expiration = dayjs(expirationTimestamp).valueOf() //ms since Unix epoch
  return expiration - dayjs(now || undefined).valueOf()
}

function isNonEmptyString (str) {
  return typeof str === 'string' && str.length > 0
}

const Chars = {
  lowers: 'abcdefghijkmnopqrstuvwxyz',
  uppers: 'ABCDEFGHJKLMNPQRSTYVWXYZ',
  numbers: '0123456789'
}
Chars.all = Chars.lowers + Chars.uppers + Chars.numbers;

function randomId (length = 6, options = {uppers: false, numbers: true, lowers: true, first: 'upper'}) {
  function getChars(options) {
    let chars = '';
    for (const charClass in Chars) {
      if (options[charClass]) {
        chars += Chars[charClass];
      }
    }
    return chars;
  }

  const first = sampleSize(Chars[`${options.first}s`], 1);
  const chars = options.uppers && options.lowers && options.numbers ? Chars.all : getChars(options);
  return first + sampleSize(chars, length - 1).join('');
}

module.exports = {
  expiresIn,
  isNonEmptyString,
  randomId
}
