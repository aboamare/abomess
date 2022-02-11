const dayjs = require('dayjs')
const utc = require('dayjs/plugin/utc')
dayjs.extend(utc)

const { expiresIn, randomId } = require('./utils')
const { InvalidMsg, MMSError, MRNChanged, ShouldBeImplementedBySubclass, UnknownPMsg } = require('./mms-errors')
const Message = require('./mms-parsers')

class DB {
  /*
   * Class to handle the information that should persist:
   * 
   * - messages that are not yet delivered and not yet expired
   * - the (sequential) internal id of the most recent message in a topic,
   *   for each agent MRN and each topic that the MRN is interested in.
   * 
   * This implementation does not persist anything, but keeps it all in memory!
   */
  constructor () {
    this.subscribers = {} 
    this.topics = {}

    process.on('beforeExit', () => {
      this.close()
    })

    this._purging = setInterval(() => {
      this.purgeExpiredMessages()
    }, 5000)

  }

  _addSubscriptions (mrn, topics) {
    if (!this.subscribers[mrn]) {
      this.subscribers[mrn] = {}
    }
    const subscriber = this.subscribers[mrn]
    for (let topic of topics) {
      const pendingTopicMessages = this.topics[topic] || []
      subscriber[topic] = subscriber[topic] || new Set(Object.keys(pendingTopicMessages))
    }
  }

  _ensureTopic (topic) {
    if (!this.topics[topic]) {
      this.topics[topic] = {}
    }
  }

  close () {
    if (this._purging) {
      clearInterval(this._purging)
      delete this._purging
    }
  }

  deleteMessage(id, topicMRN) {
    const messages = this.topics[topicMRN] || {}
    if (id in messages) {
      delete messages[id]
    }
  }

  purgeExpiredMessages () {
    const now = dayjs.utc().unix()
    const purgedIds = new Set([])
    Object.values(this.topics).forEach(topicMessages => {
      for (let id in topicMessages) {
        const message = topicMessages[id]
        if (message.expires < now) {
          delete topicMessages[id]
          purgedIds.add({topic: message.subject, id: message.id})
        }
      }
    })
    const _subsciberObjs = Object.values(this.subscribers)
    purgedIds.forEach(m => {
      _subsciberObjs.forEach(pendingMessageIds => {
        try {
          pendingMessageIds[m.topic].delete(m.id)
        } catch (err) {
          // ignore absent topic or message id
        }
      })
      console.debug(`Purged message ${m.id}`)
    })
  }

  register (mrn, topics = []) {
    this._addSubscriptions(mrn, topics)
    for (let topic of topics) {
      this._ensureTopic(topic)
    }
  }

  _saveMessageInTopic (message, topicMRN) {
    this._ensureTopic(topicMRN)
    const messages = this.topics[topicMRN]
    if (message.id in messages) {
      return // no need to save the message, it is already in the list
    }
    messages[message.id] = message // newest messages go to the end of the messages object
  }

  markAsDelivered (mrn, messages) {
    const delivered = Array.isArray(messages) ? messages : [messages]
    const subscriber = this.subscribers[mrn]
    delivered.forEach(message => {
      try {
        subscriber[message.subject].delete(message.id)
      } catch (err) {
        console.info(`delivered message ${message.id} was not marked as pending`)
      }
    })
  }

  saveMessage (message) {
    if (message.recipients) {
      for (let mrn of message.recipients) {
        this._saveMessageInTopic(message, recipient)
        const subscriber = this.subscribers[mrn]
        if (subscriber) {
          subscriber[mrn].add(message.id)
        }
      }
    } else if (message.subject) {
      const topic = message.subject
      this._saveMessageInTopic(message, topic)
      for (let subscriber of Object.values(this.subscribers)) {
        if (topic in subscriber) {
          subscriber[topic].add(message.id)
        }
      }
    }
  }

  getMessagesFor (mrn, topicMRN) {
    const subscriber = this.subscribers[mrn]
    return Array.from(subscriber[topicMRN]|| []).map(id => this.topics[topicMRN][id])
  }

  getPendingMessageCountsFor (mrn) {
    /*
     * get the count of messages waiting for the given mrn 
     * for each of the topics that the mrn is interested in.
     * 
     * Remember that a single MRN can be registered by multiple agents,
     * this DB doesn't know about agents.
     */
    const subscriber = this.subscribers[mrn]
    const counts = Object.keys(subscriber).reduce((counts, topicMRN) => {
      const pendingMessageIds = subscriber[topicMRN]
      if (pendingMessageIds.size > 0) {
        counts[topicMRN] = pendingMessageIds.size
      }
      return counts
    }, {})
    return counts
  }
}

class Agent {
  constructor (mrn = null, interests = []) {
    this._mrn = mrn
    this._interests = new Set(interests)
  }

  get mrn () {
    return this._mrn
  }

  set mrn (newMRN) {
    if (!!this._mrn && (this.mrn !== newMRN)) {
      throw new MMSError(MRNChanged)
    }
    this._mrn = newMRN
    return this._mrn 
  }

  get interests () {
    return [...this._interests]
  }

  addInterest(mrn) {
    this._interests.add(mrn)
    return mrn
  }

  send (msg = {}) {
    throw new MMSError(ShouldBeImplementedBySubclass)
  }
  
  requestAuthentication (onceAuthenticated = () => { return }) {
    this._nonce = randomId(16, {lowers: true, numbers:true, first: 'lower'})
    this._onceAuthenticated = onceAuthenticated
    this.send({authenticate: {
      nonce: this._nonce
    }})
  }

  closeConnection () {
    // subclasses may wish to do something
  }
}

class Router {
  /*
   * A network transparent implementation of a MMS Router.
   *
   * The transport layer should call "processMsg" with
   * an agent and protocol message arguments. The agent
   * should be an object that implements a "send(msg)"
   * method.
   */
  constructor (mcpCertificate, options = {}) {
    this.certificate = mcpCertificate
    this.agents = new Set([])
    this.interests = {}
    this.db = new DB()
    this.protocolMessages = new Set(['authenticate', 'authentication', 'deliver', 'register', 'send', 'unregister'])
    this.options = {
      strict: false
    }
  }

  _getMessagesFor (agent, spec) {
    const topics = (spec.interests || agent.interests).map(t => t === 'pm' ? agent.mrn : t)
    const maxNrOfMessages = spec.count || Number.MAX_SAFE_INTEGER
    const maxNrOfChars = spec.chars || Number.MAX_SAFE_INTEGER
    const messages = []
    let charCount = 0
    for (let topic of topics) {
      const topicMessages = this.db.getMessagesFor(agent.mrn, topic) //undelivered messages, oldest first
      if (spec.latests === true) {
        topicMessages.reverse() // now latest first
      }
      while (topicMessages.length && messages.length < maxNrOfMessages) {
        const message = topicMessages.shift()
        charCount += JSON.stringify(message).length
        if (charCount > maxNrOfChars) {
          return messages
        }
        messages.push(message)
      }
    }
    return messages //first message in this list is the first one that should be delivered
  }

  _ensureInterest (interest) {
    if (!this.interests[interest]) {
      this.interests[interest] = new Set([])
    }
  }

  _registerInterest (agent, interest) {
    this._ensureInterest(interest)
    this.interests[interest].add(agent)
  }

  _notify (agent, pending) {
    const notification = pending || this.db.getPendingMessageCountsFor(agent.mrn)
    if (Object.keys(notification).length) {
      agent.send({ notification })
    }
  }

  get mrn () {
    return this.certificate.uid
  }

  closeAll () {
    this.db.close()
    this.agents.forEach(agent => agent.closeConnection())
  }

  processMsg (agent, obj) {
    /*
     * Process an object with one or more protocol messages sent by an agent.
     *
     * The object has as keys the name of a protocol message and as value 
     * an object as specified by the protocol.
     */
    try {
      for (let msgName in obj) {
        if (!this.protocolMessages.has(msgName)) {
          throw new MMSError(UnknownPMsg, `${msgName} is not understood`)
        }
        const method = this[msgName]
        const msg = obj[msgName]
        if (typeof msg !== 'object') {
          throw new MMSError(InvalidMsg, `Invalid ${msgName}`)
        }
        method.call(this, agent, msg)
      }
    } catch (err) {
      if (err.code === InvalidMsg) {
        // try to inform the agent directly
        try {
          agent.send({error: err.message})
        } catch (sendError) {
          console.warn(sendError)
        }
        err.message = `Invalid ${msgName}`
      }
      throw err
    }
  }

  setOptions (options = {}) {
    Object.assign(this.options, options)
  }

  authentication (agent, obj) {
    /*
     * An agent provides proof of being the MRN it claims to be.
     *
     * Validate the proof and if deemed ok mark the agent as
     * authenticated.
     * 
     * The object is either a OIDC IdentityToken signed by a MIR,
     * or a (very similar) JWT signed with a key pair associated to
     * a X509 certificate for the MRN of the agent. The JWT contains: 
     * - a 'sub' claim with the MRN of the agent
     * - a 'nonce' claim with the nonce of the most recently received 
     *   "authenicate" message
     * - either a 'x5u' header or a 'x5c' header as defined in JWS
     * - a JWS signature  
     */
    const parsed = Message(obj, agent.mrn, { protocolMsg: true})
    if (parsed.payload && parsed.payload.nonce === agent._nonce) {
      delete agent._nonce
      agent.authenticated = dayjs.utc().toDate()
      console.info(`Agent ${agent.mrn} authenticated ${agent.authenticated}`)
      const onceAuthenticated = agent._onceAuthenticated
      if (onceAuthenticated) {
        delete agent._onceAuthenticated
      }
      if (typeof onceAuthenticated === 'function') {
        onceAuthenticated()
      }
    }
  }

  authenticate (agent, obj) {
    /*
     * An agent requests this router to authenticate itself.
     *
     * Send the agent a flat JSON JWS object with a signature
     * over the nonce that should be present in the object, and
     * include a pointer to the certificate (chain) of this router.
     */
    const nonce = obj.nonce
    if (typeof nonce === 'string' && /^[A-Za-z0-9]{10, 32}$/.test(nonce)) {
      throw new MMSError(InvalidMsg)
    }
  }

  deliver (agent, obj) {
    /*
     * Deliver the messages to the agent as specified in the object.
     *
     * The object may contain filters:
     * - interests: an array with topic MRNs or the special "dm", ordered in priority (most important first)
     * - since: an integer with the seconds since the Unix Epoch
     *
     * limiters:
     * - count: an integer with the maximum number of messages that should be sent
     * - chars: an integer with the maximun number of characters that should be delivered.
     *          Note that only complete messages will be delivered.
     *
     * and options:
     * - latests: true or false, if true the most recent messages are sent first. 
     *            If absent or false messages are sent in the order they were sent (the default).
     * - collate: true or false, if true the set of messages after filtering, ordering, 
     *            and limiting is bundled in a single protocol message, otherwise each 
     *            message is delivered individually (the default)
     */
    const messages = this._getMessagesFor(agent, obj)
    if (messages.length) {
      if (obj && obj.collate === true) {
        agent.send(messages)
        this.db.markAsDelivered(agent.mrn, messages)
      } else {
        messages.forEach(m => {
          agent.send(m)
          this.db.markAsDelivered(agent.mrn, m)
        })
      }
    }
  }


  register (agent, msg) {

    this.agents.add(agent)

    let authRequired = false

    if (!msg) {
      // no need to do anything for now
      return
    }

    // The register msg MUST have a valid MRN (for an entity)
    if (!msg.mrn) {
      throw new MMSError(InvalidMsg)
    }
    // The mrn in the msg must match the mrn of the agent (if any)
    if (!!agent.mrn && (agent.mrn !== msg.mrn)) {
      throw new MMSError(MRNChanged)
    }
    agent.mrn = msg.mrn
  
    let interests = []
    // if interests are present it MUST be an array
    if (msg.interests) {
      if (!Array.isArray(msg.interests)) {
        throw new MMSError(InvalidMsg)
      }
      interests = [...msg.interests]
      for (let interest of interests || []) {
        //TODO: check if interests is in correct format etc.
        //TODO: check that the interest is not the mrn of an entity
        agent.addInterest(interest)
        this._registerInterest(agent, interest)
      }
    }

    if (msg.dm !== false) {
      interests.unshift(agent.mrn)
      this._registerInterest(agent, agent.mrn)
      authRequired = true
    }

    this.db.register(agent.mrn, interests)

    if (authRequired) {
      agent.requestAuthentication(() => {this._notify(agent)})
    } else {
      this._notify(agent)
    }
  }

  send (agent, message) {
    /*
     * Accept a message from an agent and attempt to deliver
     * it to interest agents.
     * 
     * The message is an object that must have at least one of:
     * - subject: a string that may imply further rules on the contents of the message
     * - recipients: an array with the MRNs of the intended reciepient(s)
     * 
     * and must have:
     * - id: a version 4 UUID that identifies the message.
     * - body: a string with the body, or a flattended JSON JWS or JWE object as specified by 
     *         resp. RFC7515 and RFC7519 representing the signed or encrypted message, 
     *         or an object with contents as determined by the subject string (which then should
     *         be a URN).
     * 
     * and may have:
     * - sender: a string with the MRN of the sender, if absent the sender is assumed to be the
     *           signer in case the message was signed, and otherwise the mrn of the agent (if known)
     * - expires: an integer that expresses the timestamp in seconds since the Unix epoch when 
     *            the message content is expected to be no longer relevant and does no longer 
     *            have to be delivered. If absent 100 days from acceptance of the message is 
     *            assumed.
     */
  
    try {
      const parsed = Message(message, agent, this.options)
      this.db.saveMessage(message)

      // now find the agents that should be notified
      let agents = []
      let topics = message.recipients || message.subject
      if (typeof topics === 'string') {
        topics = [topics]
      }
      topics.forEach( topic => {
        this._ensureInterest(topic)
        agents.push(...this.interests[topic])
      })
      agents = new Set(agents)
      agents.forEach(agent => { // try to avoid sending notifications more often than every 10 secs.
        if (!agent._pendingNotification) {
          agent._pendingNotification = setTimeout(() => {
            delete agent._pendingNotification
            this._notify(agent)
          }, 10*1000)
        }
      })
    } catch (err) {
      console.warn(err)
      if (err instanceof MMSError) {
        throw new MMSError(InvalidMsg, err.message)
      }
    }
  }

  unregister (agent) {
    for (let interest in this.interests) {
      this.interests[interest].delete(agent)
      if (this.db[interest].size < 1) {
        delete this.db[interest]
      }
    }
    this.agents.delete(agent)
  }
}

module.exports = { Agent, Router }