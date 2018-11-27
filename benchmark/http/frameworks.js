'use strict';
const http = require('http');
const express = require('express');
const restify = require('restify');
const inherits = require('util').inherits;
const common = require('../common.js');
const PORT = common.PORT;

const nowProto = Object.create(http.IncomingMessage.prototype)
nowProto.now = null

let httpProto = Object.create(http.IncomingMessage.prototype)
let Req = function (req) {
  this.__req__ = req
  this.now = null
}
Object.keys(httpProto).forEach((key) => {
  Object.defineProperty(Req.prototype, key, {
    get: function () {
      return this.__req__[key]
    },
    set: function (val) {
      this.__req__[key] = val
    }
  })
})


function CustomIncomingMessage (socket) {
  http.IncomingMessage.call(this, socket)
  this.now = null
}
inherits(CustomIncomingMessage, http.IncomingMessage)

function baseHandler (req, res) {
  req.now = Date.now()
  res.statusCode = 200
  res.end(`Hello ${req.url} at ${req.now}`)
}

const expressApp = express()
expressApp.get('/', (req, res) => {
  req.now = Date.now()
  res.status(200).end(`Hello ${req.url} at ${req.now}`)
})

const restifyServer = restify.createServer()
restifyServer.get('/', (req, res, next) => {
  req.now = Date.now()
  res.sendRaw(200, `Hello ${req.url} at ${req.now}`)
  next()
})

const handlers = {
  baseline: function (req, res) {
    const now = Date.now()
    res.statusCode = 200
    res.end(`Hello ${req.url} at ${now}`)
  }, 
  modifyReq: baseHandler,
  modifyProto: baseHandler,
  newProto: baseHandler,
  replaceProto: function (req, res) {
    Object.setPrototypeOf(req, nowProto)
    req.now = Date.now()
    res.statusCode = 200
    res.end(`Hello ${req.url} at ${req.now}`)
  },
  wrapReq: (req, res) => {
    var r = new Req(req)
    r.now = Date.now()
    res.statusCode = 200
    res.end(`Hello ${req.url} at ${r.now}`)
  },
  proxy: (req, res) => {
    const r = new Proxy(req, {
      get: (_req, key) => {
        if (key === 'now') {
          return Date.now()
        }
        return _req[key]
      }
    })

    res.statusCode = 200
    res.end(`Hello ${r.url} at ${r.now}`)
  },
  modifySome: (req, res) => {
    const now = Date.now()
    if (now % 3 === 0) req.now = now
    res.statusCode = 200
    res.end(`Hello ${req.url} at ${req.now || now}`)
  },
  express: (req, res) => {
    expressApp.handle(req, res)
  },
  restify: (req, res) => {
    restifyServer._onRequest(req, res)
  }
}

const bench = common.createBenchmark(main, {
  handler: Object.keys(handlers)
});

function main ({ handler }) {
  var server

  switch (handler) {
    case 'newProto':
      server = http.createServer({
        IncomingMessage: CustomIncomingMessage
      }, handlers[handler])
      break;
    case 'modifyProto':
      http.IncomingMessage.prototype.now = null
      server = http.createServer(handlers[handler])
      break;
    default:
      server = http.createServer(handlers[handler])
  }

  server.listen(common.PORT, function () {
    bench.http({
      path: '/foo'
    }, function () {
      server.close();
    });
  });
}
