'use strict'

const { WebSocketServer } = require('ws') 
const { Agent, Router } = require('./mms-router')

class WebSocketAgent extends Agent {
  constructor (ws, router, heartRate = 4 ) {
    super()
    this._ws = ws
    this._isAlive = true

    router.register(this)

    ws.on('message', (msg) => {
      try {
        router.processMsg(this, JSON.parse(msg))
      } catch (err) {
        console.warn(`received invalid protocol message content from ${this.mrn}`)
      }
    })
    ws.on('close', () => {
      this.stopHeartbeat()
      router.unregister(this)
    })
    ws.on('pong', () => {
      this._isAlive = true
    })
    this._heartbeat = setInterval(() => {
        if (!this._isAlive) {
          this.stopHeartbeat()
          ws.terminate()
          return
        }
        this._isAlive = undefined
        ws.ping()
      }, 60 / heartRate * 1000)
  }

  stopHeartbeat () {
    if (this._heartbeat) {
      clearInterval(this._heartbeat)
      delete this._heartbeat
    }
  }

  closeConnection () {
    this.stopHeartbeat()
    this._ws.close()
  }

  send (msg) {
    this._ws.send(JSON.stringify(msg))
  }
}

const router = new Router({mrn: 'urn:mrn:mcp:id:aboamare:mms'})

const wss = new WebSocketServer({ port: 3001 })

wss.on('connection', (ws) => {
  const agent = new WebSocketAgent(ws, router)
  try {
  } catch (err) {
    console.warn(err)
    if (ws.readyState === 1) {
      ws.close(1004)
    }
  }  
})

// The module exports are here primarily to support testing
module.exports = (options = {strict: true}) => {
  router.setOptions(options)
  return {
    shutDown: () => {
      return new Promise((resolve, reject) => {
        wss.on('close', () => {
          console.info(`WebSocket server shut down`)
          resolve(true)        
        })
        wss.close()
        router.closeAll()
      })
    }
  }
}
