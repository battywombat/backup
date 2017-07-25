var net = require('net');
var http = require('http');
var fs = require('fs');
var crypto = require('crypto');

var sqlite = require('sqlite3');
var uuid = require('uuid/v4');

var common = require('./common.js');

var SCHEMA = `
CREATE TABLE users (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       hostname CHAR(20),
       password CHAR(50)
);

INSERT INTO users(hostname, password) VALUES("admin", "beginners password");

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

function promiseLoop(condition, promise) {
    'use-strict';
    var topresolve, topreject;
    var f;
    f = function () {
        return new Promise(function (resolve, reject) {
            if (topresolve === undefined) {
                topresolve = resolve;
            }
            if (topreject === undefined) {
                topreject = reject;
            }
            if (condition() !== true) {
                topresolve();
                return;
            }
            return promise().then(f, topreject);
        });
    };
    return f();
}

function ClientConnection(objStream, opts, db) {
    'use-strict';
    var self = {};

    function sendNACK(err) {
        return new Promise(function (resolve) {
            objStream.sendObject({
                type: common.commands.NACK,
                msg: err.toString()
            }).then(resolve);
        });
    }

    function sendACK() {
        return new Promise(function (resolve) {
            objStream.sendObject({
                type: common.commands.ACK
            }).then(resolve);
        });
    }

    function serverCheckPassword(handshake) {
        return new Promise(function (resolve, reject) {
            db.get("SELECT password FROM users WHERE hostname = ?", [handshake.username], function (err, row) {
                if (err) {
                    reject(err);
                }
                if (row === undefined) {
                    reject(new Error("No username " + handshake.username));
                }
                if (row.password !== handshake.secretkey) {
                    reject(new Error("Incorrect secret key"));
                }
                resolve();
            });
        });
    }

    function serverSendHandshake() {
        return new Promise(function (resolve, reject) {
            objStream.sendObject({
                username: opts.username,
                secretkey: opts.secretkey
            }).then(resolve, reject);
        });
    }

    function serverDoHandshake(handshake) {
        return new Promise(function (resolve, reject) {
            serverCheckPassword(handshake)
                .then(serverSendHandshake, reject)
                .then(resolve, reject);
        });
    }

    function testIfFileInDatabase(fileInfo) {
        return new Promise(function (resolve, reject) {
            db.get('SELECT * FROM tracked_file WHERE client_path = ? AND user_id = ?', [fileInfo.filePath, fileInfo.userId], function (err, row) {
                if (err) {
                    reject(err);
                }
                if (row !== undefined) {
                    reject(new Error("That file is already tracked"));
                }
                resolve(fileInfo);
            });
        });
    }

    function openFile(fileInfo) {
        return new Promise(function (resolve, reject) {
            fileInfo.serverPath = uuid();
            fs.open(fileInfo.serverPath, "w", function (err, fd) {
                if (err) {
                    reject(err);
                }
                fileInfo.fd = fd;
                resolve(fileInfo);
            });
        });
    }

    function downloadFile(fileInfo) {
        return new Promise(function (resolve, reject) {
            http.get({}, function (res) {
                if (res.statusCode !== 200) {
                    reject(new Error("Could not get file, error code" + res.statusCode.toString()));
                }
                var hash = crypto.createHash("sha256");
                res.on('error', reject);
                res.on('data', function (chunk) {
                    hash.update(chunk);
                    fs.write(fileInfo.fd, chunk, function (err) {
                        if (err) {
                            reject(err);
                        }
                    });
                });
                res.on('end', function () {
                    fs.close(fileInfo.fd, function (err) {
                        if (err) {
                            reject(err);
                        }
                        fileInfo.hash = hash.digest("hex");
                        resolve(fileInfo);
                    });
                });
            });
        });
    }

    function addTrackedFileToDatabase(fileInfo) {
        return new Promise(function (resolve, reject) {
            db.run("INSERT INTO tracked_files(user_id, client_path) VALUES(?, ?)", [fileInfo.userId, fileInfo.filePath], function (err) {
                if (err) {
                    reject(err);
                }
                fileInfo.trackedId = this.lastID;
                resolve(fileInfo);
            });
        });
    }

    function addStoredFileToDatabase(fileInfo) {
        return new Promise(function (resolve, reject) {
            db.run("INSERT INTO stored_files(file_id, server_path, date_added, hash) VALUES(?,?,?,?)",
                    [fileInfo.trackedId, fileInfo.serverPath, Date.now(), fileInfo.hash], function (err) {
                if (err) {
                    db.exec("DELETE FROM tracked_files WHERE id= ?", [fileInfo.trackedId], function () {
                        reject(err);
                    });
                }
                resolve();
            });
        });
    }

    function addFile(fileInfo) {
        return new Promise(function (resolve, reject) {
            testIfFileInDatabase(fileInfo)
                .then(openFile, reject)
                .then(downloadFile, reject)
                .then(addTrackedFileToDatabase, reject)
                .then(addStoredFileToDatabase, reject)
                .then(resolve, reject);
        });
    }

    function handleCommand() {
        return new Promise(function (resolve, reject) {
            objStream.recieveObject().then(function (obj) {
                if (obj.type === common.commands.HANDSHAKE) {
                    serverDoHandshake(obj).then(function () {
                        objStream.handshaked = true;
                        resolve();
                    }, reject);
                } else if (obj.type === common.commands.CLOSE) {
                    objStream.closed = true;
                    db.close(resolve);
                } else if (objStream.handshaked !== true && opts.allowSkippedHandshake === false) {
                    reject(new Error("No handshake given"));
                } else if (obj.type === common.commands.ADD_FILE) {
                    addFile(obj).then(resolve, reject);
                }
            }, reject);
        });
    }

    self.start = function () {
        db = opts.db;
        return promiseLoop(function () {
            return objStream.closed !== true;
        }, handleCommand);
    };

    self.forceClose = function () {
        objStream.closed = true;
    };

    return self;
}

function BackupServer(opts) {
    'use-strict';
    var server;
    var db;
    var initalized;
    var self = {};
    var clients = [];

    function finishClient(client, socket) {
        clients.splice(clients.indexOf(client), 1);
        socket.end();
    }

    function clientConnection(socket) {
        var objStream = new common.ObjectStream(socket);
        var newClient = new ClientConnection(objStream, opts, db);
        clients.push(newClient);
        newClient.start().then(function () {
            finishClient(newClient, socket);
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
                readOpts.db = opts.db;
                opts = readOpts.server;
                resolve();
            }, reject);
        });
    }

    function initServer() {
        server = net.createServer();
        server.on('connection', clientConnection);
    }

    function addUserOpts(db) {
        return new Promise(function (resolve, reject) {
            var username = Object.keys(opts.users)[0];
            var password = opts.users[username];
            db.run('INSERT INTO users(hostname, password) VALUES(?, ?)', [username, password], function (err) {
                if (err) {
                    reject(err);
                }
                delete opts.users[username];
                resolve();
            });
        });
    }

    function addOptsUsers(db) {

        return new Promise(function (resolve, reject) {
            if (opts.users === undefined) {
                resolve();
            }
            promiseLoop(function () {
                return Object.keys(opts.users).length > 0;
            }, function () {
                return addUserOpts(db);
            }).then(resolve, reject);
        });
    }

    function initDB() {
        function createDatabase(dbPath) {
            return new Promise(function (resolve, reject) {
                if (opts.db !== undefined) {
                    db = opts.db;
                    opts.dbPath = opts.db.filename;
                    resolve(db);
                    return;
                }
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
                addOptsUsers,
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
                server.listen(port, "localhost", 512);
                resolve();
            }, reject);
        });
    };

    self.close = function () {
        return new Promise(function (resolve) {
            server.close();
            db.close(resolve);
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