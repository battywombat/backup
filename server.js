var net = require('net');

var sqlite = require('sqlite3');

var common = require('./common.js');

var SCHEMA = `
CREATE TABLE users (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       hostname CHAR(20),
       password CHAR(50)
);

INSERT INTO users VALUES("admin", "beginners password");

CREATE TABLE tracked_files (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       user_id INT NOT NULL,
       client_path VARCHAR(255) NOT NULL,
       FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE stored_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INT NOT NULL,
    server_path VARCHAR(255) NOT NULL,
    date_added DATETIME NOT NULL,
    hash CHAR(160) NOT NULL,
    FOREIGN KEY (file_id) REFERENCES tracked_files(id)
);`;


function BackupServer(opts) {
    'use-strict';
    var server;
    var db;
    var initalized;
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
            }, reject);

        });
    }

    function handleCommand(objStream, handshaked) {
        return new Promise(function (resolve, reject) {
            objStream.recieveObject().then(function (obj) {
                if (obj.type === common.commands.HANDSHAKE) {
                    serverDoHandshake(obj).then(function () {
                        handleCommand(objStream, true);
                    }, reject);
                } else if (obj.type === common.commands.CLOSE) {
                    resolve();
                } else if (handshaked === false && opts.allowSkippedHandshake === false) {
                    reject(new Error("No handshake given"));
                }
            }, reject);
        });
    }

    function clientConnection(socket) {
        var objStream = new common.ObjectStream(socket);
        handleCommand(objStream, false).then(function () {
            socket.close();
        });
    }

    function initOpts() {
        return new Promise(function (resolve, reject) {
            common.getConfigOpts().then(function (readOpts) {
                if (opts !== undefined) {
                    Object.keys(opts).forEach(function (key) {
                        readOpts.server[key] = opts[key];
                    });
                }
                opts = readOpts.server;
                resolve();
            }, reject);
        });
    }

    function initServer() {
        server = net.createServer();
        server.on('connection', clientConnection);
    }

    function initDB() {
        function createDatabase(dbPath) {
            return new Promise(function (resolve, reject) {
                db = new sqlite.Database(dbPath, function (err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(db);
                    }
                });
            });
        }

        function checkForSchema(db) {
            return new Promise(function (resolve, reject) {
                db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='users'", undefined, function (err, row) {
                    if (err) {
                        reject(err);
                    }
                    resolve([db, row !== undefined]);
                });
            });
        }

        function createSchema(args) {
            var newDB = args[0],
                hasSchema = args[1];
            return new Promise(function (resolve, reject) {
                if (hasSchema) {
                    resolve(newDB);
                }
                newDB.exec(SCHEMA, function (err) {
                    if (err) {
                        reject(err);
                    }
                    db = newDB;
                    resolve(newDB);
                });
            });

        }

        return new Promise(function (resolve, reject) {
            createDatabase(opts.dbPath).then(
                checkForSchema,
                reject
            ).then(
                createSchema,
                reject
            ).then(
                resolve,
                reject
            );
        });
    }

    function init() {
        return new Promise(function (resolve, reject) {
            if (initalized === true) {
                resolve();
            }

            initOpts().then(initDB, reject)
                .then(function () {
                    initServer();
                    initalized = true;
                    resolve();
                }, reject);
        });
    }

    self.listen = function (port) {
        port = port || common.SERVER_DEFAULT_PORT;
        return new Promise(function (resolve, reject) {
            init().then(function () {
                server.listen(port);
                resolve();
            }, function (err) {
                reject(err);
            });
        });
    };

    self.close = function () {
        return new Promise(function (resolve) {
            server.close();
            db.close(function () {
                resolve();
            });
        });
    };

    self.on = function (type, cb) {
        server.on(type, cb);
    };

    return self;
}


module.exports = {
    BackupServer: BackupServer
};