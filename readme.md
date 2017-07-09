Description: A portable, lightweight backup server that requires no specialized knowledge to use.

Parts:
Backup protocol:
       A protocol allowing a backup server and client to communicate with each other through JSON messages.
Server:
	An implementation of the server side of the backup protocol.
client:
	An implementation of the client side of the packup protocol.


Features:
**Bold** items are advanced features, nice to have, but not neccesary.
Protocol:
* Handshaking: A client and a server should be able authenticate each other. Both the client and the server should authenticate each other. If the client or the server fail authentication, they should terminate the connection
* Adding/removing files: A client decides what files it wants to be tracked. All information about backed up files is kept on the server side, but this information is accessible via the backup protocol.
* uploading files: Once a file (or folder) is added to be tracked, a copy of it is immediately uploaded to the server. On a regular interval, this file should be checked locally for changes, and if any are found, a new copy should be uploaded
* Time machine: It should be possible to restore your files to exactly the way they were at a particular time *without* losing the way they are now. You should be able to turn the clock forward in time to present or backward to the beginning of time.
* **Incremental backups**: Rather than storing an entire file, only portions of the file that have changed should be stored. These sections should be restored in such a way that it is possible to recreate the original file

Client:
* GUI: A standard user should be able to configure what files should be backed up, and use most basic features with little effort
* Scheduling: A  regular user should be able to use this program. No special fuss or muss, modifying crontabs or messing with startup tasks. It should "just work"
* **scripting api** ...But if we did want advanced features, they should be able to go nuts. A full scripting API should be exposed so that users can write their own fancy scripts.

Server:
* Easy Administration: A simple bootstrap script run on the server should be able to set it up and get it working. Just enter an admin password and you're good to go.
* Multiple Users/coputers: A single server should be able to manage multiple clients, storing their files without messing any of them up.
* Remote access: If the IP address of a server is provided, all administration should be doable either from a client GUI or a server. Direct access to the server should not be needed.
* **Compressed files**: Files on the server will be stored in archives in order to save space.

Protocol:
The backup protocol consists of a series of JSON objects set between the client and server, with the client initiating.

A action object will be of the form
{
	"command": ['ADD_FILE'|'FILE_INFO'...]
}
A command file can only be sent by the client when there is not current action. Any action sent before the current action is completed should be ignored.

If anything goes wrong during any part of the transaction, the client will issue an error object. This will be of the form
{
	"error": "What went wrong"
}
If an acknowledgement is required but no data needs to be sent, it is sufficent to send
{
	"error" null
}
to signify the operation completed successfully.

As this is a backup protocol, large parts of it involve sending files over a network, as such, a single standard mechanism is needed for file uploads and downloads. What is done is an upload object comes in the form:

{
	"path": "path/to/file",
	"url": [url at which the file can be downloaded
}

The target can then download the file, and once it is complete, must tell the other that it has finished its download.

If an error is recieved by either the server or the client, it can be assumed that the current operation has failed, and any changes that are part of the current action must be reversed. All changes from previous operations should be safely preserved.

In general, four objects make up the "handshake": both the client and the server will send an introductory packet, identifying themselves, then they each will confirm the other partner, before sending a confirm or deny message. If either one sends a deny message, both terminate the connection. If any json objects are malformed in any way, both terminate the connection.

The structure of the introductory object is
{
	"ident": [A string identifying this user],
	"key": [a secret key unique to this user. Encrypted!]
}

After that, the client will begin to send its commands to the server. The commands are:

FILE_ADD: Add a file to be tracked by the database.
{
	"filePath": "client/file/path",
	"fileUrl": "URL where the file to be uploaded can be found",
	"port": port having the HTTP server
}
Once this message has been received by the server, the server download the file from the given URL and add it to a database. Once it has completed, the server sends the response object
{
	"fileId": [a unique id for this file]
}
The client will then use this information to add the file to its own database, with its file location being NULL.

FILE_REMOVE: Make a file untracked
{
	"filePath": "path/to/file"
}
Though changes to the file are no longer tracked, the file should not be removed from the database and should still be available for backwards time travel.

FILE_INFO: This command is used to get information about a certain file
{
	"path": "/path/to/file"
}
The returned object will be of the form:
{
	"path": "/path/to/file",
	"first_added": [date and time this file was first uploaded],
	"last_check": [date this file was last checked for backup],
	"last_save: [date this file was last backed up],
	"hash": [A hash collected from this file]
	[And various other file statistics]
}

FILES_TRACKED: Return a full list of files that are tracked by the server
The response is of the form:
{
	"paths": [
		 ...
	]
}

BACKUP: perform a full backup check
{	
	"files": [
		{
			"path": "/path/to/file",
			"hash": [An infohash of this file]
		}
		...
	]
}

The server will respond with:
{
	"files": [
		 "path1",
		 "path2",
		 "path3",
		 ...
	]
}

Which is a list of files that need to be reuploaded
The client will then respond with 
{
	"files": [
		 {
			"path":"path/to/file",
			"url": [url at which the file can be found]
		 }

	]

}
The server will then download each file that needs re-uploaded, then will send an acknowledgement to the client.

FILE_RESTORE: restore a to its state on a given date
{
	"path": "path/to/file",
	"target_date": [date the client wants the file restored to]
	"compressed": [true|false]
}
The server will then respond with a file upload object.

TIME_TRAVEL: Restore all backed up files to a state on a given time
{
	"date": [date the client wishes to return to],
	"files" [
		{
			"path": "path/to/file",
			"hash": [this files infohash]
		}
		...
	]
}
This action should combine all of FILE_RESTORE and BACKUP actions. First, it should send out all fields described in the BACKUP actions. If no files need to be backed up, then "url" will contain the address of a compressed archive containing all tracked files at that date. Otherwise, "files" contains all files that need to be backed up.
{
	"files": [
		 "path1"
		 ...

	]
	"url": null
}
After this, the client responds in its usual way...
{

	"files": [
		 [see backup above]
	]
}
At which point, the server will send an object containing the url of the compressed files.


Units:
Client:
	connectToServer(url, port): connect to the stored backup server before sending commands
	fileAdd(path): add the given file to be tracked	
	fileRemove(path): remove the given tracked file
	fileInfo(path): give information on the given file
	filesTracked(): get a list of all tracked files
	backup(): backup all files
	fileRestore(path, date): restore the given file to its state on the given date
	timeTravel(date): carry out the time travel action
Server:
	listen(): Listen for incoming connections
	newConnection(): handle an incoming connection (handshake, main loop, etc.)
	handleFileAdd(): handle the FILE_ADD action
	handleFileRemove(): handle the FILE_REMOVE action
	handleFileInfo(): handle the FILE_INFO action
	handleBackup(): handle BACKUP action
	handleFileRestore(): handle FILE_RESTORE action
	handleTimeTravel(): handle TIME_TRAVEL action
	handle filesTracked() handle FILES_TRACKED
Common:
	sendHandshake(socket): send a handshake to the server/client
	confirmHandshake(): confirm that the values sent by a handshake are okay
	sendObject(socket, object): send an object down the internet tubes
	recieveObject(socket): receive an object from the internet tubes
	createUploadServer(port, urls): create a server mapping the urls to the given file paths
	destroyUploadServer(server): Destroy a created upload server
	scheduleFunction(time, func): Schedule a particular function to be run at a particular time
	createInterfaceServer(port): create local server that can be used to manage the backup server


database schema:

CREATE TABLE users (
       id INT NOT NULL UNIQUE AUTO_INCREMENT,
       hostname CHAR(20),
       password CHAR(50)
);

INSERT INTO users VALUES("admin", "beginners password");

CREATE TABLE tracked_files (
       id INT NOT NULL UNIQUE AUTO_INCREMENT,
       user_id INT NOT NULL,
       client_path VARCHAR(255) NOT NULL,
       FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE stored_files (
    id INT NOT NULL UNIQUE AUTO_INCREMENT,
	file_id INT NOT NULL,
	server_path VARCHAR(255) NOT NULL,
	date_added DATETIME NOT NULL,
	hash CHAR(160) NOT NULL,
	FOREIGN KEY (file_id) REFERENCES tracked_files(id)
);