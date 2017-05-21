var net = require('net');

var common = require('./common.js');


function BackupClient(configpath) {
    'use-strict';
    var socket;
    var self = {};

    self.connect = function (host, port) {
        host = host || "localhost";
        port = port || common.SERVER_DEFAULT_PORT;
        return new Promise(function (resolve, reject) {
            socket = net.connect({
                port: port,
                host: host
            }, function () {
                resolve(socket);
            });
            socket.on('error', function (err) {
                reject(err);
            });
        });
    };

    return self;
}