var _ = require('underscore');
var WebSocket = require('ws');
var uuid = require('node-uuid');
var Promise = require('bluebird');

var Connection = require('./../connection');
var JanusConnection = require('./connection');
var JanusError = require('./error');
var serviceLocator = require('./../service-locator');

/**
 * @param {Number} listenPort
 * @param {String} janusAddress
 * @constructor
 */
function JanusProxy(listenPort, janusAddress) {
  this.port = listenPort;
  this.janusAddress = janusAddress;
  this.connections = {};
}

JanusProxy.prototype.start = function() {
  var proxy = this;
  var webSocketServer = this.getWebSocketServer();

  webSocketServer.on('connection', function(incomingConnection) {
    try {
      var outgoingConnection = proxy.openWebSocket();
      var fromClientConnection = new Connection('browser', incomingConnection);
      var toJanusConnection = new Connection('janus', outgoingConnection);
      proxy.establishConnection(fromClientConnection, toJanusConnection);

    } catch (error) {
      serviceLocator.get('logger').error('Unexpected JanusProxy runtime error: ' + error);
      if (fromClientConnection) {
        fromClientConnection.close();
      }
      if (toJanusConnection) {
        toJanusConnection.close();
      }
    }
  });
};

/**
 * @param {Connection} fromClientConnection
 * @param {Connection} toJanusConnection
 * @returns {JanusConnection}
 */
JanusProxy.prototype.createConnection = function(fromClientConnection, toJanusConnection) {
  return new JanusConnection(uuid.v4(), fromClientConnection, toJanusConnection);
};

/**
 * @param {Connection} fromClientConnection
 * @param {Connection} toJanusConnection
 * @returns {JanusConnection}
 */
JanusProxy.prototype.establishConnection = function(fromClientConnection, toJanusConnection) {
  var proxy = this;
  var connection = proxy.createConnection(fromClientConnection, toJanusConnection);
  proxy.addConnection(connection);

  var handleError = function(error) {
    proxy.handleError(error, fromClientConnection);
  };

  fromClientConnection.on('message', function(request) {
    connection.processMessage(request).then(function() {
      toJanusConnection.send(request);
    }, handleError);
  });

  toJanusConnection.on('message', function(request) {
    connection.processMessage(request).then(function() {
      fromClientConnection.send(request);
    }, handleError);
  });

  fromClientConnection.on('close', function() {
    fromClientConnection.removeAllListeners();
    if (toJanusConnection.isOpened()) {
      toJanusConnection.close();
    }
    proxy.removeConnection(connection);
  });

  toJanusConnection.on('close', function() {
    toJanusConnection.removeAllListeners();
    if (fromClientConnection.isOpened()) {
      fromClientConnection.close();
    }
    proxy.removeConnection(connection);
  });

  fromClientConnection.on('error', handleError);
  toJanusConnection.on('error', handleError);

  return connection;
};

/**
 * @param {Error} error
 * @param {Connection} fromClientConnection
 */
JanusProxy.prototype.handleError = function(error, fromClientConnection) {
  if (error instanceof JanusError.Fatal || !(error instanceof JanusError.Error)) {
    var logMessage = error.stack || error.message || error;
    serviceLocator.get('logger').error(logMessage);
    fromClientConnection.close();
  } else {
    serviceLocator.get('logger').info(error);
    fromClientConnection.send(error.getWebSocketMessage());
  }
};

/**
 * @returns {WebSocket.Server}
 */
JanusProxy.prototype.openWebSocket = function() {
  return new WebSocket(this.janusAddress, 'janus-protocol');
};

/**
 * @returns {WebSocket.Server}
 */
JanusProxy.prototype.getWebSocketServer = function() {
  var webSocketServer = new WebSocket.Server({port: this.port});
  serviceLocator.get('logger').debug('WebSocket server on port ' + this.port + ' started');
  return webSocketServer;
};

/**
 * @param {JanusConnection} connection
 */
JanusProxy.prototype.addConnection = function(connection) {
  this.connections[connection.id] = connection;
  serviceLocator.get('logger').info('Added ' + connection);
};

/**
 * @param {JanusConnection} connection
 */
JanusProxy.prototype.removeConnection = function(connection) {
  if (this.connections[connection.id]) {
    connection.onRemove();
    delete this.connections[connection.id];
  }
};

/**
 * @returns {Promise}
 */
JanusProxy.prototype.stop = function() {
  var proxy = this;
  _.each(proxy.connections,
    function(connection) {
      proxy.removeConnection(connection);
    }
  );
  return Promise.resolve();
};

module.exports = JanusProxy;
