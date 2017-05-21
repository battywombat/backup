var http = require('http');
var net = require('net');
var fs = require('fs');

var chai = require('chai');
var common = require('../common');

var port = 9002;

function makeObjectStream() {
    'use-strict';
    return new Promise(function (resolve) {
        var serverStream,
            clientStream,
            osServer = net.createServer(function (c) {
                serverStream = new common.ObjectStream(c);
                serverStream.socket = c;
                osServer.close();
                resolve({
                    server: serverStream,
                    client: clientStream
                });
            });
        osServer.listen(port, 'localhost');
        port += 1;
        clientStream = new common.ObjectStream({
            port: port - 1,
            host: 'localhost'
        });
    });
}

describe('ObjectStream', function () {
    'use-strict';
    var serverOS,
        osServer = net.createServer(function (c) {
            serverOS = new common.ObjectStream(c);
            serverOS.socket = c;
        });

    osServer.listen(9001, 'localhost');

    after(function () {
        osServer.close();
    });

    describe("#sendObject", function () {
        it('should reject if no object is given as an argument', function (done) {
            var clientOS = new common.ObjectStream({
                port: 9001,
                host: 'localhost'
            });
            clientOS.sendObject().then(function () {
                done(new Error("Should not have sent an object"));
            }, function (err) {
                chai.expect(err).to.not.equal(undefined);
                done();
            });
        });

        it('should resolve with no arguments if the object is successfully passed', function (done) {
            var clientOS = new common.ObjectStream({
                port: 9001,
                host: 'localhost'
            });
            clientOS.sendObject({}).then(function () {
                done();
            }, function (err) {
                done(err);
            });
        });

        it("Should send some data thorugh its socket", function (done) {
            makeObjectStream().then(function (obj) {
                var client = obj.client,
                    server = obj.server;
                server.socket.on('data', function () {
                    done();
                });
                client.sendObject({});
            }, function (err) {
                done(err);
            });
        });
    });

    describe("#recieveObject", function () {
        it('Will correctly recieve a single object', function (done) {
            makeObjectStream().then(function (obj) {
                var client = obj.client,
                    server = obj.server;
                server.sendObject({});
                client.recieveObject().then(function (o) {
                    chai.expect(o).to.be.a('object');
                    done();
                }, function (err) {
                    done(err);
                });
            }, function (err) {
                done(err);
            });
        });

        it("Will raise an error if the recieved object is malformed", function (done) {
            makeObjectStream().then(function (socks) {
                var client = socks.client,
                    server = socks.server;
                server.socket.write('2{a');
                client.recieveObject().then(function () {
                    done(new Error("Somehow parsed broken object"));
                }, function (err) {
                    chai.expect(err).to.not.equal(undefined);
                    done();
                });
            }, function (err) {
                done(err);
            });
        });

        it("Will recieve multiple objects in a row, in the correct order", function (done) {
            var obj1 = {
                prop: 1
            },
                obj2 = {
                    prop: 2
                },
                clientOS = new common.ObjectStream({
                    port: 9001,
                    host: 'localhost'
                });
            serverOS.sendObject(obj1).then(function () {
                return serverOS.sendObject(obj2);
            }, function (err) {
                done(err);
            });
            clientOS.recieveObject().then(function (o) {
                chai.expect(o.prop).to.equal(obj1.prop);
            }, function (err) {
                done(err);
            });
            clientOS.recieveObject().then(function (o) {
                chai.expect(o.prop2).to.equal(obj2.prop);
                done();
            }, function (err) {
                done(err);
            });
        });

        it('Should reject incorrect objects in the recieved order', function (done) {
            var obj1 = {
                prop: 1
            },
                str = "3{ab",
                clientOS = new common.ObjectStream({
                    port: 9001,
                    host: 'localhost'
                });
            serverOS.sendObject(obj1).then(function () {
                serverOS.socket.write(str);
            }, function (err) {
                done(err);
            });

            clientOS.recieveObject().then(function (o) {
                chai.expect(o.prop).to.equal(obj1.prop);
            }, function (err) {
                done(err);
            });

            clientOS.recieveObject().then(function () {
                done(new Error("Last recieved object should be broken"));
            }, function (e) {
                chai.expect(e).to.equal(undefined);
                done();
            });
        });

        it('should correctly parse object that span more than one chunk', function (done) {
            var begin = '{"',
                end = '": 1}',
                middle = "a",
                final = begin,
                i = 0,
                max = 512;
            makeObjectStream().then(function (streams) {
                var client = streams.client,
                    server = streams.server;
                while (i < max) {
                    begin += middle;
                    i += 1;
                }
                try {
                    final = JSON.parse(begin + end);
                } catch (e) {
                    done(e);
                }
                server.sendObject(final).then(client.recieveObject()).then(function (obj) {
                    chai.expect(obj).to.be.a('object');
                    done();
                }, function (err) {
                    done(err);
                });
            }, function (err) {
                done(err);
            });
        });
    });
});

describe('UploadServer', function () {
    'use-strict';

    it('should allow a text file to be uploaded', function (done) {
        var receivedBuffer = Buffer.from([]);
        var uploadServer = new common.UploadServer({
            port: 8001
        }, {
            "/a": './common.js'
        });
        uploadServer.listen();
        http.get({
            port: 8001,
            path: "/a"
        }, function (res) {
            if (res.statusCode !== 200) {
                done(new Error("Error code: " + 200));
            }
            res.on('data', function (chunk) {
                receivedBuffer = Buffer.concat([receivedBuffer, chunk]);
            });
            res.on('end', function () {
                fs.readFile('./common.js', function (err, data) {
                    uploadServer.close();
                    if (err) {
                        done(err);
                        return;
                    }
                    if (receivedBuffer.equals(data)) {
                        done();
                    } else {
                        done(new Error("Buffers are not equal"));
                    }
                });
            });
        });
    });

    it('should send an error code if path is not present', function (done) {
        var uploadServer = new common.UploadServer({
            port: 8001
        }, {
            '/a': './common.js'
        });
        uploadServer.listen();
        http.get({
            port: 8001,
            path: '/fake'
        }, function (res) {
            if (res.statusCode === 200) {
                done(new Error("Sent nonexistent file"));
            } else {
                done();
            }
        });
    });
});