var net = require('net');

var chai = require('chai');

var common = require('../common');
var backupserver = require('../server');

describe('BackupServer', function () {
    'use-strict';
    describe('#listen', function () {
        var srv;
        beforeEach(function (done) {
            srv = new backupserver.BackupServer({
                allowSkippedHandshake: true,
                users: {
                    testuser: 'fakekey'
                }
            });
            srv.listen().then(function () {
                done();
            }, function (err) {
                done(err);
            });
        });
        afterEach(function () {
            srv.close();
        });
        it('should use to connect to the server on the default port', function (done) {
            var sock = net.connect({
                port: common.SERVER_DEFAULT_PORT
            }, function () {
                done();
            });
            sock.on('error', function (err) {
                done(err);
            });
        });
        it('should send a handshake object', function (done) {
            var sock = net.connect({
                port: common.SERVER_DEFAULT_PORT
            });

            var objStream = common.ObjectStream(sock);
            objStream.sendObject({
                username: 'testuser',
                secretkey: 'fakekey',
                type: common.commands.HANDSHAKE
            }).then(objStream.recieveObject()).then(function (obj) {
                chai.expect(obj).to.be.an('Object', "No object sent");
                chai.expect(obj.username).to.be.a('string', "No username");
                chai.expect(obj.secretkey).to.be.a('string', "No secret key");
                done();
            }, function (err) {
                done(err);
            });

            sock.on('err', function (err) {
                done(err);
            });
        });
    });
});