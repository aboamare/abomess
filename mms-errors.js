class MMSError extends Error {
  constructor (code, msg) {
    if (!MMSError.Codes[code]) {
      throw new Error(`Invalid MMS error code ${code}`)
    }
    super(msg || MMSError.Codes[code])
    this.code = code
  }
}

MMSError.Codes = {
  InvalidMsg: 'Protocol message content is invalid',
  MRNChanged: 'MRN changed',
  ShouldBeImplementedBySubclass: 'Should be implemented by subclass',
  UnknownMsg: 'Protocol message is not known',
  NoSender: 'Sender of message could not be determined',
  InvalidSignature: 'Message signature could not be validated',
  InvalidMessage: 'Message is not valid'
}


module.exports = Object.assign({ MMSError }, Object.keys(MMSError.Codes).reduce((codes, code) => {
    codes[code] = code
    return codes
  }, {}))