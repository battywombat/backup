var fs = require('fs');
var net = require('net');

var chai = require('chai');
var sqlite = require('sqlite3');

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
            srv.listen().then(done, done);
        });
        afterEach(function () {
            srv.close();
        });
        it('should connect to the server on the default port', function (done) {
            var sock = net.connect(common.SERVER_DEFAULT_PORT, function (e) {
                done(e);
            });
            sock.on('error', done);
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
            }).then(objStream.recieveObject).then(function (obj) {
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

    describe("#initDB", function () {
        var srv;
        var db;
        var testDBPath = "./fake";

        function connectDB() {
            return new Promise(function (resolve, reject) {
                srv = new backupserver.BackupServer({dbPath: testDBPath});
                srv.listen(9002).then(function () {
                    db = new sqlite.Database(testDBPath, function (err) {
                        if (err) {
                            reject(err);
                        }
                        resolve(db);
                    });
                });
            });
        }

        function deleteDB() {
            return new Promise(function (resolve, reject) {
                fs.unlink(testDBPath, function (err) {
                    if (err) {
                        reject(err);
                    }
                    resolve();
                });
            });
        }

        function checkDB(db) {
            return new Promise(function (resolve, reject) {
                db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='users'", undefined, function (err, row) {
                    if (err || row === undefined) {
                        reject(err);
                    }
                    resolve();
                });

            });
        }

        it("Should create the database if it has not already been initalized", function (done) {
            srv = backupserver.BackupServer({dbPath: testDBPath});
            srv.listen().then(connectDB, done)
                .then(checkDB, done)
                .then(deleteDB, done)
                .then(done, done);
        });
    });
});