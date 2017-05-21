/**
 * Common data needed by {@link backup/server} and {@link backup/client}.
 * @module backup/common
 */
var net = require('net');
var os = require('os');
var path = require('path');
var fs = require('fs');
var http = require('http');
var StringDecoder = require('string_decoder').StringDecoder;


var SERVER_DEFAULT_PORT = 9001;

/**
 * @property {string} client.host The host of the remote server to connect to
 * @property {Integer} client.port The port on which the remote server is listening
 * @property {string} client.username The username unique to this *computer* used to identify it to the server
 * @property {string} client.key A secret key used to authenticate this user by the server.
 */
var defaultConfig = {
    'client': {
        'host': 'localhost',
        'port': SERVER_DEFAULT_PORT,
        'username': 'testuser',
        'key': "secretkeydontsteal"
    },
    'server': {
        'users': {
            'testuser': 'secretkeydontsteal'
        },
        'username': 'serveruser',
        'secretkey': 'otherkey'
    }
};

/**
 * Get the stored configuration options
 * @param {string} fp The path to look for configuration options. Defaults to ~/.backup
 * @returns {Object} An object containing basic configuration options
 */
function getConfigOpts(fp) {
    'use-strict';
    var configfp = fp || path.join(os.homedir(), '.backup'),
        decoder = new StringDecoder('utf-8'),
        jsonStr;
    return new Promise(function (resolve, reject) {
        fs.exists(configfp, function (exists) {
            if (exists) {
                fs.readFile(configfp, function (err, data) {
                    if (err) {
                        reject(err);
                    }
                    try {
                        jsonStr = decoder.write(data);
                        resolve(JSON.parse(jsonStr));
                    } catch (e) {
                        reject(e);
                    }
                });
            } else {
                fs.writeFile(configfp, Buffer.from(JSON.stringify(defaultConfig)), function (err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(defaultConfig);
                    }
                });
            }
        });
    });
}

/**
 * A wrapper around a socket that can send or recieved length prefixed JSON objects.
 * ObjectStream uses a promise-based API that supports two methods: recieveObject and sendObject.
 * @constructor
 * @typedef {{Object|net.Socket}} SocketOpts.
 * @param {SocketOps} opts Either an object of parameters with which to create a socket, or a socket on which to listen
 * @return {ObjectStream} An ObjectStream Object
 */
var ObjectStream = (function () {
    'use-strict';

    var receivedProto = {
        finished: false,
        length: 0,
        err: undefined,
        resolve: undefined,
        reject: undefined
    };

    return function (opts) {
        var socket = undefined,
            received = [],
            dataBuffer = "",
            decoder = new StringDecoder('utf-8');

        if (opts instanceof net.Socket) {
            socket = opts;
        } else {
            socket = new net.connect(opts);
        }

        function getNext() {
            var i = 0;
            if (received.length === 0) {
                received.push(Object.create(receivedProto));
                return received[0];
            }
            while (i < received.length) {
                if (received[i].finished !== true) {
                    break;
                }
                i += 1;
            }
            return received[i];
        }

        function getWaiting() {
            var i = 0,
                p = undefined;
            while (i < received.length) {
                if (received[i].resolve === undefined) {
                    return received[i];
                }
                i += 1;
            }
            p = Object.create(receivedProto);
            received.push(p);
            return p;
        }

        socket.on('data', function (data) {
            var next = getNext(),
                jsonString = undefined;
            dataBuffer += decoder.write(data);

            if (next.length === 0) {
                next.length = parseInt(dataBuffer, 10);
                dataBuffer = dataBuffer.substring(next.length.toString().length, dataBuffer.length);
            }

            if (next.length >= dataBuffer.length) {
                jsonString = dataBuffer.substring(0, next.length);
                try {
                    next.obj = JSON.parse(jsonString);
                } catch (e) {
                    next.err = e;
                }
                next.finished = true;
                dataBuffer = dataBuffer.substring(next.length, dataBuffer.length);
            }
            if (next.finished && next.resolve !== undefined && next.reject !== undefined) {
                if (next.err !== undefined) {
                    next.reject(next.err);
                } else {
                    next.resolve(next.obj);
                }
                received.splice(0, 1);
            }
        });

        socket.on('error', function (err) {
            var next = getNext();
            next.err = err;
            next.finished = true;
        });


        return {
            /**
             * Recieve an object from the socket.
             * @name {ObjectStream.recieveObject}
             * @returns {Promise.<Object, Error>} A promise that will reject if an error occurs, else return an Object read from the stream.
             */
            recieveObject: function () {
                return new Promise(function (resolve, reject) {
                    var waiting = getWaiting();

                    if (waiting.obj) {
                        resolve(waiting.obj);
                    } else if (waiting.err) {
                        reject(waiting.err);
                    } else {
                        waiting.resolve = resolve;
                        waiting.reject = reject;
                    }
                });
            },
            /**
             * Send an object through the socket.
             * @name {ObjectStream.sendObject}
             * @param {Object} obj The object to send through the socket.
             * @returns {Promise.<Void, Error>} A promise that will reject with an error if one occurs, else will resolve.
             */
            sendObject: function (obj) {
                return new Promise(function (reject, resolve) {
                    var jsonString = JSON.stringify(obj);

                    socket.write(jsonString.length.toString() + jsonString, function (err) {
                        if (err) {
                            reject(err);
                        } else {
                            resolve();
                        }
                    });
                });
            },

            /**
             * Close the underlying socket
             * @name {ObjectStream.close}
             * @returns {Void}
             */
            close: function () {
                socket.destroy();
            }
        };
    };
}());


/**
 * Create and serve uploads over HTTP
 * @param {Object} opts The options used to create the server
 * @param {Object} files a mapping of route:filePath for files to be uploaded
 */
function UploadServer(opts, files) {
    'use-strict';
    function checkExists(fp) {
        return function (exists) {
            if (exists === false) {
                files[fp] = undefined;
            }
        };
    }
    Object.keys(files).forEach(function (val) {
        files[val] = path.resolve(files[val]);
        fs.exists(files[val], checkExists(val));
    });
    var server = http.createServer(function (request, response) {
        var url, file, headerSet;
        if (request.url.indexOf("/") === 0) {
            url = request.url.substring(0, request.url.length);
        } else {
            url = request.url;
        }
        if (files[url] !== undefined) {
            file = fs.createReadStream(files[url]);
            file.on('error', function (err) {
                if (headerSet !== true) {
                    response.writeHead(500, {'Content-Type': "text-plain"});
                    response.write(Buffer.from(err.message));
                    headerSet = true;
                }
                response.end();
                file.destroy();
            });

            file.on('data', function (data) {
                if (headerSet !== true) {
                    response.writeHead(200, {'Content-Type': 'application/octet-stream'});
                    headerSet = true;
                }
                response.write(data);
            });

            file.on('end', function () {
                response.end();
            });

        } else {
            response.writeHead(404, {'Content-Type': "text/plain"});
            response.end();
        }
    });

    return {
        listen: function (port) {
            server.listen(port || opts.port);
        },
        close: function () {
            server.close();
        }
    };
}

var commands = {
    CLOSE: "CLOSE",
    HANDSHAKE: "HANDSHAKE"
};

module.exports = {
    ObjectStream: ObjectStream,
    getConfigOpts: getConfigOpts,
    UploadServer: UploadServer,
    SERVER_DEFAULT_PORT: SERVER_DEFAULT_PORT,
    commands: commands
};
