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
        clientStream.connect();
    });
}

describe('ObjectStream', function () {
    'use-strict';
    var server,
        serverEnd,
        clientEnd;

    beforeEach(function (done) {
        server = net.createServer(function (c) {
            serverEnd = new common.ObjectStream(c);
            serverEnd.socket = c;
            done();
        });
        server.listen(9001, 'localhost', function () {
            clientEnd = new common.ObjectStream({
                port: 9001,
                host: 'localhost'
            });
            clientEnd.connect();
        });
    });

    afterEach(function (done) {
        serverEnd.close();
        clientEnd.close();
        server.close(done);
    });

    describe("#sendObject", function () {
        it('should reject if no object is given as an argument', function (done) {
            clientEnd.sendObject().then(function () {
                done(new Error("Should not have sent an object"));
            }, function (err) {
                chai.expect(err).to.not.equal(undefined);
                done();
            });
        });

        it('should resolve with no arguments if the object is successfully passed', function (done) {
            clientEnd.sendObject({})
                .then(done, done);
        });

        it("Should send some data thorugh its socket", function (done) {
            serverEnd.socket.on('data', function () {
                done();
            });
            clientEnd.sendObject({});
        });
    });

    describe("#recieveObject", function () {
        it('Will correctly recieve a single object', function (done) {
            serverEnd.sendObject({});
            clientEnd.recieveObject().then(function (o) {
                chai.expect(o).to.be.a('object');
                done();
            }, done);
        });

        it("Will raise an error if the recieved object is malformed", function (done) {
            serverEnd.socket.write('2{a');
            clientEnd.recieveObject().then(function () {
                done(new Error("Somehow parsed broken object"));
            }, function (err) {
                chai.expect(err).to.not.equal(undefined);
                done();
            });
        });

        it("Will recieve multiple objects in a row, in the correct order", function (done) {
            var obj1 = {
                    prop: 1
                },
                obj2 = {
                    prop: 2
                };
            function sendObject1() {
                return serverEnd.sendObject(obj1);
            }
            function sendObject2() {
                return serverEnd.sendObject(obj2);
            }
            sendObject1()
                .then(sendObject2)
                .then(clientEnd.recieveObject)
                .then(function (o) {
                    chai.expect(o.prop).to.equal(obj1.prop);
                }, done)
                .then(clientEnd.recieveObject, done)
                .then(function (o) {
                    chai.expect(o.prop).to.equal(obj2.prop);
                    done();                   
                }, done);
        });

        it('Should reject incorrect objects in the recieved order', function (done) {
            var obj1 = {
                    prop: 1
                },
                str = "3{ab";
            function sendObject1() {
                return serverEnd.sendObject(obj1);
            }
            sendObject1()
                .then(function () {
                    serverEnd.socket.write(str);
                }, done)
                .then(clientEnd.recieveObject, done)
                .then(function (o) {
                    chai.expect(o.prop).to.equal(obj1.prop);
                    return clientEnd.recieveObject();
                }, done)
                .then(function () {
                    done(new Error("Last recieved object should be broken"));                    
                }, function (e) {
                    chai.expect(e).to.not.equal(undefined);
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
            while (i < max) {
                begin += middle;
                i += 1;
            }
            try {
                final = JSON.parse(begin + end);
            } catch (e) {
                done(e);
            }
            serverEnd.sendObject(final).then(clientEnd.recieveObject).then(function (obj) {
                chai.expect(obj).to.be.a('object');
                done();
            }, done);

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