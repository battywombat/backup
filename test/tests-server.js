var fs = require('fs');
var net = require('net');

var chai = require('chai');
var sqlite = require('sqlite3');

var common = require('../common');
var backupserver = require('../server');

describe('BackupServer', function () {
    'use-strict';
    var srv;
    var db;
    var testDBPath = "./fake";

    function createTestUser() {
        return new Promise(function (resolve, reject) {
            db.run("INSERT INTO users(hostname, password) VALUES('testuser', 'fakekey')", function (err) {
                if (err) {
                    reject(err);
                }
                resolve();
            });
        });
    }

    function connectDB() {
        return new Promise(function (resolve, reject) {
            db = new sqlite.Database(testDBPath, function (err) {
                if (err) {
                    reject(err);
                }
                resolve(db);
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

    beforeEach(function (done) {
        connectDB().then(function () {
            srv = new backupserver.BackupServer({db: db});
            srv.listen(common.SERVER_DEFAULT_PORT)
                .then(createTestUser, done)
                .then(done, done);
        }, done);
    });

    afterEach(function (done) {
        srv.close().then(deleteDB, done).then(done, done);
    });

    describe('#listen', function () {
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
            }).then(objStream.recieveObject, done).then(function (obj) {
                chai.expect(obj).to.be.an('Object', "No object sent");
                chai.expect(obj.username).to.be.a('string', "No username");
                chai.expect(obj.secretkey).to.be.a('string', "No secret key");
                done();
            }, done);

            sock.on('err', done);
        });
    });

    describe("#initDB", function () {

        function checkDB() {
            return new Promise(function (resolve, reject) {
                db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='users'", undefined, function (err, row) {
                    if (err || row === undefined) {
                        reject(err);
                    }
                    resolve();
                });

            });
        }

        it("Should create the database", function (done) {
            checkDB().then(done, done);
        });
    });
});