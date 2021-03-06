var sinon = require('sinon');
var fs = require('fs');
var assert = require('chai').assert;

var serviceLocator = require('../../../../lib/service-locator');
var RtpbroadcastThumbnailJob = require('../../../../lib/job/model/rtpbroadcast-thumbnail');
var CmApplication = require('../../../../lib/cm-application');
var Logger = require('../../../../lib/logger');


describe('imports archive', function() {

  var cmApplication;

  before(function() {
    cmApplication = sinon.createStubInstance(CmApplication);
    serviceLocator.register('logger', sinon.stub(new Logger));
    serviceLocator.register('cm-application', cmApplication);
  });

  after(function() {
    serviceLocator.reset();
  });

  describe('given invalid jobData ', function() {
    it('with missing jobData.thumb it should reject', function() {
      var jobData = {
        id: 'stream-channel-id'
      };
      assert.throws(function() {
        new RtpbroadcastThumbnailJob(jobData);
      }, /No `thumb` parameter provided/);
    });
  });

  describe('given valid jobData', function() {

    var job;

    before(function(done) {
      var jobData = {
        thumb: 'video-file',
        id: 'stream-channel-id'
      };
      job = new RtpbroadcastThumbnailJob(jobData);
      sinon.stub(job, '_exec', function(command, callback) {
        callback(null);
      });
      job.run().then(done);
    });

    it('should extract png thumbnail from video file', function() {
      var commandArgs = job._exec.firstCall.args[0].split(' ');
      assert(fs.existsSync(commandArgs[0]), 'script ' + commandArgs[0] + ' does not exist');
      assert.match(commandArgs[0], /rtpbroadcast-thumb\.sh$/);
      assert.equal(commandArgs[1], 'video-file');
      assert.match(commandArgs[2], /\.png$/);
    });

    it('should import png file into cm-application', function() {
      var commandArgs = job._exec.firstCall.args[0].split(' ');
      assert(cmApplication.importVideoStreamThumbnail.calledOnce, 'importVideoStreamThumbnail was not called');
      assert.equal(cmApplication.importVideoStreamThumbnail.firstCall.args[0], 'stream-channel-id');
      assert.equal(cmApplication.importVideoStreamThumbnail.firstCall.args[1], commandArgs[2]);
    });

  });
});

