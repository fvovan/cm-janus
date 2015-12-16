var chai = require('chai');
var expect = chai.expect;
var sinon = require('sinon');


var Promise = require('bluebird');
var Stream = require('../../../../lib/stream');
var PluginStreaming = require('../../../../lib/janus/plugin/streaming');
var Connection = require('../../../../lib/janus/connection');
var Session = require('../../../../lib/janus/session');
var Logger = require('../../../../lib/logger');
var CmApiClient = require('../../../../lib/cm-api-client');
var Streams = require('../../../../lib/streams');
var JanusHttpClient = require('../../../../lib/janus/http-client');
var serviceLocator = require('../../../../lib/service-locator');

describe('PluginStreaming', function() {
  var plugin, session, connection, cmApiClient, streams, httpClient;

  beforeEach(function() {
    serviceLocator.register('logger', sinon.stub(new Logger));
    connection = new Connection('connection-id');
    session = new Session(connection, 'session-id', 'session-data');
    plugin = new PluginStreaming('plugin-id', 'plugin-type', session);
    session.plugins[plugin.id] = plugin;

    cmApiClient = sinon.createStubInstance(CmApiClient);
    serviceLocator.register('cm-api-client', cmApiClient);
    streams = sinon.createStubInstance(Streams);
    serviceLocator.register('streams', streams);
    httpClient = sinon.createStubInstance(JanusHttpClient);
    serviceLocator.register('http-client', httpClient);
  });

  context('when processes "create" message', function() {
    var transaction;

    beforeEach(function() {
      sinon.spy(connection.transactions, 'add');
      plugin.processMessage({
        janus: 'message',
        body: {
          request: 'create',
          id: 'channel-name',
          channel_data: 'channel-data'
        },
        transaction: 'transaction-id'
      });
      transaction = connection.transactions.add.firstCall.args[1];
    });

    it('transaction should be added', function() {
      expect(connection.transactions.add.calledOnce).to.be.equal(true);
    });

    context('on unsuccessful transaction response', function() {
      it('should resolve', function(done) {
        transaction({}).then(function() {
          done();
        }, done);
      });
    });

    context('on successful transaction response', function() {
      var executeTransactionCallback;

      beforeEach(function() {
        executeTransactionCallback = function() {
          return transaction({
            janus: 'success',
            plugindata: {
              data: {
                id: 'plugin-id'
              }
            }
          });
        };
        cmApiClient.publish.restore();
        sinon.stub(cmApiClient, 'publish', function() {
          return Promise.resolve();
        });
      });

      it('should set stream', function(done) {
        executeTransactionCallback().finally(function() {
          expect(plugin.stream).to.be.instanceOf(Stream);
          expect(plugin.stream.channelName).to.be.equal('channel-name');
          expect(plugin.stream.plugin).to.be.equal(plugin);
          done();
        });
      });

      it('should publish', function(done) {
        executeTransactionCallback().finally(function() {
          expect(cmApiClient.publish.calledOnce).to.be.equal(true);
          var args = cmApiClient.publish.firstCall.args;
          expect(args[0]).to.be.equal('channel-name');
          expect(args[1]).to.be.a('string');
          expect(args[2]).to.be.closeTo(Date.now() / 1000, 5);
          expect(args[3]).to.be.equal('session-data');
          expect(args[4]).to.be.equal('channel-data');
          done();
        });
      });

      context('on successful publish', function() {
        it('should add stream to streams', function(done) {
          executeTransactionCallback().finally(function() {
            done();
          });
        });
      });

      context('on unsuccessful publish', function() {
        beforeEach(function() {
          cmApiClient.publish.restore();
          sinon.stub(cmApiClient, 'publish', function() {
            return Promise.reject(new Error('Cannot publish'));
          });
        });

        it('should detach and should reject', function(done) {
          executeTransactionCallback().then(function() {
            done(new Error('Should not resolve'));
          }, function(error) {
            expect(httpClient.detach.callCount).to.be.equal(1);
            expect(error.message).to.include('error: Cannot publish');
            done();
          });
        });
      })
    });
  });

  context('when processes "webrtcup" message', function() {
    var processWebrtcupMessage;

    beforeEach(function() {
      plugin.stream = new Stream('stream-id', 'channel-name', plugin);
      processWebrtcupMessage = function() {
        return plugin.processMessage({
          janus: 'webrtcup',
          transaction: 'transaction-id'
        });
      };

      cmApiClient.subscribe.restore();
      sinon.stub(cmApiClient, 'subscribe', function() {
        return Promise.resolve();
      });
    });

    it('should subscribe', function(done) {
      processWebrtcupMessage().finally(function() {
        expect(cmApiClient.subscribe.calledOnce).to.be.equal(true);
        var args = cmApiClient.subscribe.firstCall.args;
        expect(args[0]).to.be.equal('channel-name');
        expect(args[1]).to.be.equal('stream-id');
        expect(args[2]).to.be.closeTo(Date.now() / 1000, 5);
        expect(args[3]).to.be.equal('session-data');
        done();
      });
    });

    context('on successful subscribe', function() {
      it('should add stream to streams', function(done) {
        processWebrtcupMessage().finally(function() {
          done();
        });
      });
    });

    context('on unsuccessful subscribe', function() {
      beforeEach(function() {
        cmApiClient.subscribe.restore();
        sinon.stub(cmApiClient, 'subscribe', function() {
          return Promise.reject(new Error('Cannot subscribe'));
        });
      });

      it('should detach and should reject', function(done) {
        processWebrtcupMessage().then(function() {
          done(new Error('Should not resolve'));
        }, function(error) {
          expect(httpClient.detach.callCount).to.be.equal(1);
          expect(error.stack).to.include('error: Cannot subscribe');
          done();
        });
      });
    })
  });

  context('when removed', function() {
    it('should remove stream', function() {
      sinon.stub(plugin, 'removeStream');
      plugin.onRemove();
      expect(plugin.removeStream.calledOnce).to.be.equal(true);
    });
  });

  context('with existing stream', function() {
    var stream;

    beforeEach(function() {
      stream = new Stream('stream-id', 'channel-name', plugin);
      plugin.stream = stream;
      streams.has.returns(true);
    });
    context('when removes stream', function() {
      beforeEach(function() {
        plugin.removeStream();
      });

      it('should remove stream reference', function() {
        expect(plugin.stream).to.be.equal(null);
      });

      it('should remove stream from streams', function() {
        expect(streams.has.withArgs(stream.id).calledOnce).to.be.equal(true);
        expect(streams.remove.withArgs(stream).calledOnce).to.be.equal(true);
      });

      it('should call cmApiClient removeStream', function() {
        expect(cmApiClient.removeStream.calledOnce).to.be.equal(true);
        var args = cmApiClient.removeStream.firstCall.args;
        expect(args[0]).to.be.equal('channel-name');
        expect(args[1]).to.be.equal('stream-id');
      });
    });
  })
});