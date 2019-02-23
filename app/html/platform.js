defaultParams.laf = "bundle";
analyticsVersion = 'V'+latestVersion.replace(/^5/,"6")+"-offline";
startDelay = 500;
appOnline = false;



//https://gist.github.com/paulcbetts/2d2de55d137a1cf9d1ac
function installAnalytics(gaID){
	// grab a uuid to identify the session
	// set the uuid to local storage
	if (!localStorage["gaClientId"]){
	    localStorage.setItem("gaClientId","R"+Math.round(Math.random()*1E12)*1000+new Date().getMilliseconds());
	}
	// set the cookie storage for google analytics to none, and provide your own client id
	var clientId = localStorage["gaClientId"];
	ga('create', gaID,{
	    'storage': 'none',
	    'clientId': clientId
	});
	// finally, disable the protocol check to allow file://
	ga('set', 'checkProtocolTask', function(){}); // Disable file protocol checking.
}

function ggbExamMode(exam){
	var xhr = new XMLHttpRequest();
	xhr.open("GET","file://html/"+(exam ? "GGB_EXAM_ON" : "GGB_EXAM_OFF"));
	xhr.send();
}

function setUnsavedMessage(message, save, noSave, cancel){
	console.trace(message);
	var xhr = new XMLHttpRequest();
	xhr.open("GET","file://html/SETUNSAVED?json=" + JSON.stringify([message,save,noSave,cancel]));
	xhr.send();
}

/* Giac evaluate. It calls the Node version of Giac from main.js (window.ipc was already loaded via preload.js). */
function evalGeoGebraCASExternal(command) {
	return window.ipc.sendSync('giac', command);
}

console.log = function(message) {
        window.ipc.sendSync('log', message);
}

function copyGraphicsToClipboardExternal(data) {
	return window.ipc.sendSync('clipboard', data);
}