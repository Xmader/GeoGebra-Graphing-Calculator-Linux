// Parse command line options and collect those that will be important immediately.
parseCommandLineOptions();

// Logging helper commands.
function printError(msg, e) {
    if (!muteLogging) {
        console.log("\x1b[31m%s: \x1b[1m%s\x1b[0m", msg, e);
    } else {
        console.log("\x1b[31m%s\x1b[0m", msg);
    }
}

function printDebug(msg) {
    if (!muteLogging) {
        console.log(msg);
    }
}

function printInfo(msg) {
    console.log("\x1b[1m%s\x1b[0m", msg);
}

// Communication related code from GeoGebra to Electron.
ipc = require('electron').ipcMain;

// Giac evaluate, called in platform.js via ipc.
nodegiac = {}
if (forceWasm) {
    printDebug("Forcing Wasm");
    nodegiac.evaluate = function () {
        return "?"
    }
}
else try {
    nodegiac = require('bindings')('giac');
} catch (e) {
    printError("Error on loading Giac", e);
    printDebug("Falling back to Wasm");
    nodegiac.evaluate = function () {
        // We will fall back to WASM in this case.
        return "?"
    };
}

// ipc calls from GeoGebra.
ipc.on('giac', function (event, command) {
        command = command.replace(/;+$/, ''); // right trim ; characters
        if (!command.startsWith("caseval(")) command = "caseval(" + command + ")";
        var ret = nodegiac.evaluate(command);
        event.returnValue = ret;
        if (!muteLogging) {
            // Print fancy log message
            console.log("\x1b[33mGiac: \x1b[41m\x1b[1m%s \x1b[33m\x1b[0m\x1b[33m -> \x1b[1m\x1b[44m%s\x1b[0m", command, ret);
        }
    }
);
ipc.on('log', function (event, message) {
        event.returnValue = true;
        if (!muteLogging) {
            // Print fancy log message
            console.log("\x1b[36mGeoGebra: \x1b[1m%s\x1b[0m", message);
        }
        if (logWatch) {
            if (!logExitFound) {
            if ((pos = message.search(logExit)) > 0)
                logExitFound = true;
                }
            if (logExitFound) {
                printDebug("Exiting due to matching log text");
                process.exit(0);
                }
            }
        if (getVersion) {
            if (geoGebraVersion != "undef") {
                process.exit(0);
            }
            if ((message.search("INFO") > 0) && ((pos = message.search("GeoGebra")) > 0))
                geoGebraVersion = message.substring(pos);
        }
    }
);
ipc.on('clipboard', function (event, data) {
        event.returnValue = true;
        const nativeImage = require('electron').nativeImage
        img = nativeImage.createFromDataURL(data)

        const {clipboard} = require('electron')
        clipboard.write({image: img})
    }
);

const {app, BrowserWindow, Menu} = require('electron');
const Config = require('electron-config');
const path = require('path');
const ggbConfig = require('./ggb-config.js');
// For some reason, when using Ermine to create an all-in-one bundle,
// this line results in a "SyntaxError: Unexpected token export", so
// we load 'windows-shortcuts' later only, when explicitly needed.
// const ws = require('windows-shortcuts');

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let win

function createWindow(appArgs) {

    // Create the browser window...
    var pref = {
        show: false,
        width: 1024,
        height: 768,
        title: "GeoGebra",
        webPreferences: {nodeIntegration: false, preload: __dirname + '/preload.js'}
    };
    const config = new Config();
    Object.assign(pref, config.get('winBounds'))

    // ...and load the index.html of the app.
    // See the function onReady() later that prepares the variable appArgs.
    var startUrl = `file://html/index.html?`;
    var perspective = appArgs && appArgs['perspective'] ? appArgs['perspective'] : ggbConfig.appName;
    if (perspective && perspective.match(/^graphing|geometry|notes$/)) {
        startUrl = "file://html/" + perspective + ".html?";
        pref.icon = __dirname + "/html/" + perspective + ".ico";
    } else if (perspective) {
        startUrl += "?perspective=" + appArgs['perspective'];
    }
    if ((appArgs && appArgs['prerelease']) || perspective == "notes") {
        startUrl += "&prerelease=" + appArgs['prerelease'];
    }
    if (appArgs && appArgs['debug']) {
        startUrl += "&debug=" + appArgs['debug'];
    }
    if (appArgs && appArgs['filename']) {
        startUrl += "&filename=" + appArgs['filename'];
    }
    if (appArgs && appArgs['ggbbase64']) {
        startUrl += "&ggbbase64=" + appArgs['ggbbase64'];
    }

    win = new BrowserWindow(pref);
    win.setMenuBarVisibility(false);
    win.setAutoHideMenuBar(true);
    win.loadURL(startUrl);

    // Open the DevTools.
    // win.webContents.openDevTools()
    win.webContents.on('did-finish-load', () => {
        pref.show = true;
        win.show();
    });
    // Emitted when the window is closed.
    win.on('closed', () => {
        printDebug("Window is closed");
        if (getVersion) {
            version6 = geoGebraVersion.match(/GeoGebra (5\.\d+\.\d+\.\d)/); // async
            version6 = (version6[0]).replace(" 5", " 6");
            printInfo(version6); // Maybe we want to print more information later. TODO
        }
        // Dereference the window object, usually you would store windows
        // in an array if your app supports multi windows, this is the time
        // when you should delete the corresponding element.
        win = null
    })
    win.unsaved = null;
    win.on('close', (e) => {
        if (!win.unsaved || !win.unsaved[0]) {
            config.set('winBounds', win.getBounds());
            return;
        }
        e.preventDefault();
        // Dereference the window object, usually you would store windows
        // in an array if your app supports multi windows, this is the time
        // when you should delete the corresponding element.
        const {dialog} = require('electron');

        dialog.showMessageBox(win, {message: win.unsaved[0], buttons: win.unsaved.slice(1)}, function (e) {
            if (e == 0) {
                win.loadURL("javascript:ggbApplet.checkSaved()");
            }
            if (e == 1) {
                win.unsaved = false;
                setTimeout(function () {
                    win.close();
                }, 100);
            }
        });

    });

}

function trySpawn(execRelative, params, callback) {
    var exec = process.execPath + "/../" + execRelative;
    callback = callback || function () {
    };
    var spawn2 = require("child_process");
    const fs = require('fs');
    fs.access(exec, (err) => {
        err ? printError("Error on trySpawn", err) : callback(spawn2.spawn(exec, params))
    });
}

function getWinLocaleSync() {
    try {
        const crossSpawn = require('child_process');
        const lcid = require('lcid');
        const stdout = crossSpawn.spawnSync('wmic', ['os', 'get', 'locale'], {"encoding": "utf-8"}).stdout;
        const lcidCode = parseInt(stdout.replace('Locale', ''), 16);
        return lcid.from(lcidCode);
    } catch (e) {
        printError("Error on getWinLocaleSync", e);
    }
    return "en_US";
}

function getAppleLocaleSync() {
    try {
        const crossSpawn = require('child_process');
        return crossSpawn.spawnSync('defaults', ['read', '-g', 'AppleLocale']).stdout;
    } catch (e) {
        printError("Error on getAppleLocaleSync", e);
    }
    return "en_US";
}

function createShortcuts(locations) {
    var exe = process.execPath.split("\\").reverse()[0];
    for (var k in locations) {
        var basePath = false;
        if (locations[k] == "Desktop") {
            basePath = p`${'userDesktop'}`;
        }
        if (locations[k] == "StartMenu") {
            basePath = p`${'appData'}/Microsoft/Windows/Start Menu/Programs/GeoGebra`;
        }
        if (basePath) {
            var loc = getWinLocaleSync();
            var dict = ggbConfig.localization.appName;
            var localizedName = dict[loc] || dict[loc.substr(0, 2)] || dict["none"];
            var lnkPath = basePath + "/" + localizedName + ".lnk";

            const ws = require('windows-shortcuts');
            ws.create(lnkPath, {
                    target: process.execPath + "/../../Update.exe",
                    icon: process.execPath,
                    args: "--processStart=" + exe
                },
                () => {
                    process.exit(0)
                });

        }
    }
}

const environmentVariableAliases = {
    'HOME': 'home',
    'USERPROFILE': 'home',
    'APPDATA': 'appData',
    'TEMP': 'temp',
    'TMPDIR': 'temp'
};

function getPath(key) {

    let aliasKey = null;
    if (environmentVariableAliases[key]) {
        aliasKey = environmentVariableAliases[key];
    }

    let result = null;

    if (app) {
        try {
            result = app.getPath(aliasKey || key);
        } catch (e) {
            printError("Failed to get path for key", (aliasKey || key) + " may be expected");
            // NB: We'd like to log this but this method gets called too early:
            // logger.debug(`Failed to get path for key, this may be expected: ${aliasKey || key}`);
            // The above should work, but it has not yet been tested. TODO
        }
    }

    result = result || process.env[key];
    if (!result) {
        // NB: Try to fix up the most commonly fucked environment variables
        if (key.toLowerCase() === 'appdata' && process.env.USERPROFILE) {
            result = path.join(process.env.USERPROFILE, 'AppData', 'Roaming');
        }

        if (key.toLowerCase() === 'localappdata' && process.env.USERPROFILE) {
            result = path.join(process.env.USERPROFILE, 'AppData', 'Local');
        }
    }

    return result;
}

function p(strings, ...values) {
    let newVals = values.map((x) => getPath(x) || x);
    let newPath = String.raw(strings, ...newVals);
    let parts = newPath.split(/[\\\/]/).map((x) => x || '/');

    // Handle Windows edge case: If the execution host is cmd.exe, path.resolve() will not understand
    // what `C:` is (it needs to be `C:\`).
    if (process.platform === 'win32' && /:$/.test(parts[0])) parts[0] += '\\';

    try {
        return path.resolve(...parts);
    } catch (e) {
        return path.join(...parts);
    }
}

function updateShortcuts() {
    let locations = [];
    printDebug("Shortcuts update started.");
    const fs = require('fs');
    var dirs = [p`${'appData'}/Microsoft/Windows/Start Menu/Programs/Startup`,
        p`${'appData'}/Microsoft/Windows/Start Menu/Programs/GeoGebra`,
        p`${'appData'}/Microsoft/Windows/Start Menu/Programs/GeoGebraFake`,
        p`${'userDesktop'}`];

    function updateIcon(filename, description, callback) {
        var currentFolder = process.execPath.replace(/\\[^\\]*$/, "");
        var appFolder = process.execPath.replace(/\\[^\\]*\\[^\\]*$/, "");
        var exe = process.execPath.split("\\").reverse()[0];
        var target = description.expanded.target;
        var updater = appFolder + "\\Update.exe";
        if (target === process.execPath || target === updater) {
            printDebug("Updating... filename=" + filename + ", description=" + description);
            const ws = require('windows-shortcuts');
            ws.edit(filename, {
                "target": updater, "workingDir": currentFolder, "icon": process.execPath,
                "args": "--processStart=" + process.execPath
            }, callback);
        } else {
            callback();
        }
    }

    function checkdir(i) {
        if (!dirs[i]) {
            process.exit(0);
        }
        fs.readdir(dirs[i], function (err, files) {
            function checkFile(j) {
                f = files && files[j];
                if (f && f.match(/.lnk$/)) {
                    const ws = require('windows-shortcuts');
                    ws.query(dirs[i] + "/" + f, (errF, description) => {
                        updateIcon(dirs[i] + "/" + f, description, () => checkFile(j + 1));
                    });
                } else if (files && files[j + 1]) {
                    checkFile(j + 1);
                } else {
                    checkdir(i + 1);
                }
                return true;
            }

            checkFile(0);
        });
    }

    checkdir(0);
}

// On Raspberry Pi the GPU emulation is too slow, so we disallow using GPU completely:
if (!(process.arch === 'arm')) {
    app.commandLine.appendSwitch("ignore-gpu-blacklist");
}

if (process.platform === 'darwin') {
    const {systemPreferences} = require('electron');
    systemPreferences.setUserDefault('NSDisabledDictationMenuItem', 'boolean', true);
    systemPreferences.setUserDefault('NSDisabledCharacterPaletteMenuItem', 'boolean', true);
}

function onReady() {
    var nogui = false;
    var appArgs = {};
    process.argv.forEach(function (val, index, array) {
        if (val.match(/^--debug/)) {
            appArgs['debug'] = true;
        }
        if (loadFilename != "undef") {
            appArgs['filename'] = loadFilename;
        }
        if (ggbbase64 != "undef") {
            appArgs['ggbbase64'] = ggbbase64;
        }
        if (val.match(/^--app=/)) {
            appArgs['perspective'] = val.match(/^--app=(.*)/)[1];
        }
        if (val.match(/^--squirrel/) && !val.match(/^--squirrel-firstrun/)) {
            nogui = true;
            if (val.match(/^--squirrel-install/)) {
                createShortcuts(["Desktop", "StartMenu"]);
                printDebug("Icon creation");

            } else if (val.match(/^--squirrel-update/)) {
                updateShortcuts();

            } else {
                // --squirrel-obsolete, ...
                process.exit(0);
            }

            return;
        }
    });
    if (nogui) {
        printDebug("No GUI, exiting");
        return;
    }

    if (process.platform === 'darwin') {
        // Create our menu entries so that we can use MAC shortcuts
        var displayNames = {
            "graphing": "GeoGebra Graphing Calculator",
            "classic": "GeoGebra Classic 6",
            "geometry": "GeoGebra Geometry",
            "notes": "Mebis Notes"
        };
        app.setName(displayNames[ggbConfig.appName || "classic"]);
        Menu.setApplicationMenu(Menu.buildFromTemplate([
            {
                label: 'GeoGebra', // ignored
                submenu: [
                    {role: 'quit'} // label set by app.getName
                ]
            },
            {
                label: 'Edit',
                submenu: [
                    {role: 'copy'},
                    {role: 'cut'},
                    {role: 'paste'},
                ]
            }]
        ));
    }
    app.setAppUserModelId("com.squirrel.geogebra.GeoGebra");
    let {protocol} = require('electron');
    //protocol.registerStandardSchemes(['ggb'])
    protocol.unregisterProtocol('file', () => {
    });

    function localProtocol(request, callback) {
        const url = request.url.substr(5, request.url.length - 5);
        if (url.match(/GGB_EXAM_ON/i)) {
            trySpawn("disablekeys.exe", [], (proc) => {
                global.disablekeys = proc
            });
            win.setKiosk(true); //disables all system shortcuts on Mac and ESC on Windows
            return;
        }
        if (url.match(/GGB_EXAM_OFF/i)) {
            win.setKiosk(false);

            if (global.disablekeys) {
                global.disablekeys.kill();
            }
        }
        if (url.match(/SETUNSAVED/i)) {
            var messagesJSON = decodeURIComponent(url.substring(url.indexOf("=") + 1));
            win.unsaved = JSON.parse(messagesJSON);
            return;
        }

        const bits = url.split("?");
        const urlPath = bits[0];
        const normalized = path.normalize(`${__dirname}/${urlPath}`);
        callback({path: normalized});
        printDebug("File " + normalized + " is to be loaded...");
    }

    function localError(error) {
        if (error) {
            printError("Error", "Failed to register protocol");
        } else {
            printDebug('Registered protocol succesfully');
        }
    }

    protocol.registerFileProtocol('file', localProtocol, localError);
    protocol.registerFileProtocol('app', localProtocol, localError);
    createWindow(appArgs);
    if (/^win/.test(process.platform)) {
        const subfolder = !ggbConfig.appName || (ggbConfig.appName == "classic") ? "" : (ggbConfig.appName + "/");
        trySpawn("../Update.exe", ["--update", "https://download.geogebra.org/installers/6.0/" + subfolder]);
    } else {
        printDebug("No autoupdate for " + process.platform);
    }

}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', onReady);

// Quit when all windows are closed.
app.on('window-all-closed', () => {
    // On macOS it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    app.quit()
});

app.on('activate', () => {
    printDebug("activate");
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (win === null) {
        createWindow({})
    }
});

function parseCommandLineOptions() {
    muteLogging = true;
    getVersion = false;
    geoGebraVersion = "undef";
    loadFilename = "undef";
    ggbbase64 = "undef";
    forceWasm = false;
    logWatch = false;
    logExitFound = false;
    var options = process.argv.length;
    var lastDetectedOption = 0;

    process.argv.forEach(function (val, index, array) {
        if (index > 0) {
            if (val.match(/^--help/)) {
                printInfo("GeoGebra Classic 6");
                printInfo("Copyright © The GeoGebra Group, 2018\n")
                printInfo("See https://www.geogebra.org/license for license conditions.");
                printInfo("See https://www.geogebra.org/team for the list of authors.\n");
                printInfo("Usage: " + process.argv[0] + " [options] [FILE]\n");
                printInfo("Options:");
                printInfo("  --help              Print this help message");
                printInfo("  --v                 Print version");
                printInfo("  --silent=false      Enable logging");
                printInfo("  --giac=wasm         Disable native CAS and use WebAssembly instead");
                printInfo("  --logexit=<text>    Exit when the log contains a given text (as regexp)");
                process.exit(0);
            } else if (val.match(/^--giac=wasm/)) {
                forceWasm = true;
                lastDetectedOption = index;
            } else if (val.match(/^--logexit=/)) {
                logWatch = true;
                logExit = val.match(/^--logexit=(.*)/)[1];
                lastDetectedOption = index;
            } else if (val.match(/^--silent=false/)) {
                muteLogging = false;
                lastDetectedOption = index;
            } else if (val.match(/^--v/)) {
                getVersion = true;
                lastDetectedOption = index;
            } else {
                if (index < options - 1) {
                    printError("Unrecognized option", val);
                }
            }
        }

        if (index == options - 1 && index > lastDetectedOption && !getVersion) {
            if (val.match(/^http/)) {
                printInfo("Attempt to open URL " + val);
                loadFilename = val;
            } else {
                const fs = require('fs');
                const path = require('path');
                var appAbsPath = path.resolve(__dirname);
                var absfile = path.relative(appAbsPath, val);
                printInfo("Attempt to load file " + val);
                try {
                    ggbfile = fs.readFileSync(path.join(__dirname, absfile));
                    ggbbase64 = Buffer.from(ggbfile).toString('base64');
                } catch (e) {
                    printError("Cannot open file", e);
                }
            }
        }
    })
}
