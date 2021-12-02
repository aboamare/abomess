const uuid = require('uuid')

const { MMSError, InvalidMessage, InvalidSignature, NoSender } = require('./mms-errors')
const { isNonEmptyString } = require('./utils')

class Message {
  constructor (message, sender, options = { protocolMsg: false, strict: true }) {
    if (options.protocolMsg !== true) {
      if (! (typeof message.subject === 'string' || Array.isArray(message.recipients))) {
        throw new MMSError(InvalidMessage, `MMS Message must have subject or recipients!`)
      }
      if (options && options.strict) {
        // check for an id, should be a UUID v4
          try {
            if (uuid.validate(message.id) !== 4) {
              throw TypeError('Message id is not a valid v4 UUID')
            }
          } catch (err) {
            throw new MMSError(InvalidMessage, 'Message id is not a valid UUID')
          }
        // check for a sender
        if (!sender) {
          if (! isNonEmptyString(message.sender)) { //TODO: allow for list of routers in message ?
            throw new MMSError(NoSender)
          }
        }
        if (isNonEmptyString(sender)) {
          if (message.sender && message.sender !== sender) {
            throw new MMSError(InvalidMessage, 'Sender of message is not the agent')
          }
        }
      }
      if (!message.id) {
        message.id = uuid.v4()
      }  
    }
    Object.assign(this, message)
    this.sender = sender
  }

}

class SignedMessage extends Message {
  constructor (message, sender, options) {
    super(message, sender, options)
  }

}
 
function parsedMessage(message, sender = null, options = { strict: false }) {
  if (isNonEmptyString(message.signature)) {  // assume a flat JWS JSON serialization
    if(isNonEmptyString(message.payload) && isNonEmptyString(message.protected)) {
      // really looks like a JWS so let's try
      return new SignedMessage(message, sender, options)
    }
  }

  // fall back to "null" parser
  return new Message(message, sender, options)
}

module.exports = (message, sender = null, options = {strict: false}) => parsedMessage(message, sender, options)