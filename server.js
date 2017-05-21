var net = require('net');

var common = require('./common.js');

function BackupServer(opts) {
    'use-strict';
    var server;
    var self = {};

    function serverDoHandshake(objStream, handshakeObj) {
        var username = handshakeObj.username,
            secretkey = handshakeObj.secretkey;

        return new Promise(function (resolve, reject) {
            if (!opts.users.hasOwnProperty(username) || opts.users[username] !== secretkey) {
                reject(new Error("Invalid secret key"));
            }
            objStream.sendObject({
                username: opts.username,
                secretkey: opts.secretkey
            }).then(function () {
                resolve();
            }, function (err) {
                reject(err);
            });

        });
    }

    function handleCommand(objStream, handshaked) {
        return new Promise(function (resolve, reject) {
            objStream.recieveObject().then(function (obj) {
                if (obj.type === common.commands.HANDSHAKE) {
                    serverDoHandshake(obj).then(function () {
                        handleCommand(objStream, true);
                    }, function (err) {
                        reject(err);
                    });
                } else if (obj.type === common.commands.CLOSE) {
                    resolve();
                }
                if (handshaked === false && opts.allowSkippedHandshake === false) {
                    reject(new Error("No handshake given"));
                }
            }, function (err) {
                reject(err);
            });
        });
    }

    function clientConnection(socket) {
        var objStream = new common.ObjectStream(socket);
        handleCommand(objStream, false).then(function () {
            socket.close();
        }, function (err) {
            console.log(err);
            socket.close();
        });
    }

    self.listen = function (port) {
        port = port || common.SERVER_DEFAULT_PORT;
        server = net.createServer();
        server.on('connection', clientConnection);
        return new Promise(function (resolve, reject) {
            if (opts === undefined) {
                common.getConfigOpts().then(function (readOpts) {
                    opts = readOpts.server;
                    server.listen(port);
                    resolve();
                }, function (err) {
                    reject(err);
                });
            } else {
                server.listen(port);
                resolve();
            }
        });
    };

    self.close = function () {
        server.close();
    };

    self.on = function (type, cb) {
        server.on(type, cb);
    };

    return self;
}


module.exports = {
    BackupServer: BackupServer
};