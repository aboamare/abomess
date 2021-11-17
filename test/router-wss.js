const { after, before, describe, it } = require('mocha')
const chai = require('chai')
const expect = chai.expect
chai.use(require('chai-like'))

const uuid = require('uuid')
const { WebSocket } = require('ws')

class WsTestAgent extends WebSocket {
  constructor (url) {
    super(url)
    this.on('message', (msgStr) => {
      if (this._msgPromise) {
        try {
          const msgObj = JSON.parse(msgStr)
          this._msgPromise.resolve(msgObj)
        } catch (err) {
          this._msgPromise.reject(err)
        } finally {
          delete this._msgPromise
        }
      }
    })
  }

  connect () {
    return new Promise((resolve, reject) => {
      if (this.readyState === 1) {
        resolve(this)
      } else {
        this.on('open', () => {
          resolve(this)
        })
      }
    })
  }

  send (obj, createMsgPromise = false) {
    let msgPromise = undefined
    if (createMsgPromise) {
      msgPromise = new Promise((resolve, reject) => {
        console.debug('created message promise')
        this._msgPromise = {resolve, reject}
      })
    }
    super.send(JSON.stringify(obj))
    return msgPromise || this
  }
}

let routerUrl, shutDown, client

describe('Router Tests', function() {

  before(function() {
    console.log('in before')
    routerUrl = 'ws://localhost:3001/router'
    shutDown = require('../server')().shutDown
  })

  describe('post test messages', function () {
    let client
    it('post message with neither subject nor recipients', async function () {
      client = client && client.readyState ? client : new WsTestAgent(routerUrl)
      await client.connect()
      const result = await client.send({send: {body: 'test message without subject or recipient'}}, true)
      expect(result).to.have.property('error')
    })
    it('post message with subject but no id', async function () {
      client = client && client.readyState ? client : new WsTestAgent(routerUrl)
      await client.connect()
      const result = await client.send({send: {subject: 'test-subject-A'}}, true)
      expect(result).to.have.property('error')
    })
    it('post message with subject but invalid id', async function () {
      client = client && client.readyState ? client : new WsTestAgent(routerUrl)
      await client.connect()
      const result = await client.send({send: {id: 'foo', subject: 'test-subject-A'}}, true)
      expect(result).to.have.property('error')
    })
    it('post message with subject and valid id but no sender', async function () {
      client = client && client.readyState ? client : new WsTestAgent(routerUrl)
      await client.connect()
      const result = await client.send({send: {
        id: uuid.v4(), 
        subject: 'test-subject-A',
        body: 'test message 1'
      }})
      expect(result).to.have.property('error')
    })
  })
  
  after(async function() {
    await shutDown()
  })

})