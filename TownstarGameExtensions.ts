// Installation instructions can be found here:
// * https://github.com/rjamesnw/town-star-extensions
// If you are new to the game, join here:
// * https://gala.fan/ZuShEZ3Ql
//
// ==UserScript==
// @name         Town Star Extension Scripts
// @description  Scripts to extends Town Star.
// @version      2.13.0
// @author       General Fault
// @match        *://*.sandbox-games.com/*
// @run-at document-idle
// @icon         https://www.google.com/s2/favicons?domain=gala.games
// @grant        none
// @updateURL    https://havenbot.ngrok.io/ts/tse.js
// @supportURL   https://discord.gg/eZmpyHxfnW
// ==/UserScript==
//
// Release notes: Target system removed.
var townstarExtensionsVersion = "2.13.0";
var townstarExtensionsBotHost = "https://havenbot.ngrok.io";
//var townstarExtensionsBotHost = "http://localhost:5531";

declare namespace HUD {
    export var instance: {
        lastStorageJson: string | object;
        laborCost: HTMLElement;
    };
}

declare var API: any, debugging: number;

var TSAPI: any;

namespace TownstarExtensions {

    // Tampermonkey:
    export var version = townstarExtensionsVersion;

    console.log(`Installing script ${version} ...`);

    /** Quick custom function to execute after all extensions have been started. */
    export var onStarted: { (): void }[] = [];

    /** These events trigger when a trade is made on competing towns. */
    export var onOtherTrade: { (data: any): void }[] = [];

    type ExtensionType = { new(replacing: IExtension): IExtension; current?: IExtension; }

    interface IExtension {
        /** Triggers when the API is started, or restarted. */
        start(): boolean;
        /** Triggers when the API stops, such as just before upgrading. */
        stop(): boolean;
        /** Runs once each second (time may be different if 'Timer Delay' configuration is changed). */
        onTimer?(): Generator;
        /** Should return a configuration HTML body for the extension (no title required as it is added automatically).
         * Use the `API.create...()` functions to create input elements for configurations. See other implementations for examples. */
        getConfig(): HTMLElement;
        /** The API uses this to determine if the extension has started. This should be set to true by the extension after is starts successfully. If not, and API will assume it is not running. */
        readonly started: boolean;
    }

    interface IRegisteredExtension {
        /** The name of the extension. */
        name: string;
        /** The extension instance. */
        extension: IExtension;
        /** After an in-process upgrade, previously started extensions will restart. */
        wasStarted: boolean;
        /** References an onTimer() generator function (to support async). */
        process?: Generator;
    }

    var oldGameExt: typeof API;
    eval("if (typeof TownstarExtensions != 'undefined') oldGameExt = TownstarExtensions.API;"); // (if already defined, stop it)

    // ====================================================================================================================

    var userVerified = false;
    var validationError = "";

    export abstract class API {
        static extensions: { [index: string]: IRegisteredExtension } = {};

        /** This is toggled by the host for clients responsible to send game updates.  If a host goes offline, the next available game client is selected. */
        static isHosting = false;

        static timerHandle: any;
        static configScreen: HTMLElement;
        static configSections = new Map<object, HTMLElement>();
        static leaderboard: ILeaderBoardEntry[];

        static get townExists() { return !!Game.town; }

        static async hash(value: string) { // (no longer used at the moment)
            const msgUint8 = new TextEncoder().encode(value);                           // encode as (utf-8) Uint8Array
            const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);           // hash the message
            const hashArray = Array.from(new Uint8Array(hashBuffer));                     // convert buffer to byte array
            const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join(''); // convert bytes to hex string
            return hashHex;
        }

        static toNumber(value: number | string, defaultValue?: number): number {
            var num = +(value === null ? void 0 : value); // (coerce null to NaN via undefined)
            return isNaN(num) ? defaultValue : num;
        }

        static register(name: string, extension: ExtensionType) {
            if (name in this.extensions) {
                console.log(`* Extension '${name}' already registered, upgrading ...`);
                this.extensions[name].wasStarted = this.extensions[name].extension.stop();
                if (this.extensions[name].wasStarted)
                    console.log(` - Extension '${name}' was already started, so we'll start it again when the upgrade completes ...`);
            } else {
                console.log(`* Extension '${name}' registering ...`);
                this.extensions[name] = { name, extension: null, wasStarted: false };
            }

            this.extensions[name].extension = extension.current = new extension(this.extensions[name].extension);
        }

        static settings: { [index: string]: any } = {};
        static _saveTimer: number;

        private static _touch() {
            if (this._saveTimer)
                clearTimeout(this._saveTimer);
            this._saveTimer = setTimeout(this.save.bind(API), 1000); // (wait until writing is completed, then save after 1 sec)
        }

        static save() {
            if (this._saveTimer) {
                clearTimeout(this._saveTimer);
                this._saveTimer = void 0;
            }
            try {
                var content = JSON.stringify(this.settings);
                console.log("Saving settings ...");
                console.log(content);
                localStorage.setItem("tse_api", content);
                console.log("Settings saved.");
            }
            catch (err) {
                throw "Failed to save to local storage (FYI, may not work in private browsing mode): " + err;
            }
        }

        /**
         * Sets a value in the global settings. Use this to set and store persisted settings values.
         * @param name Property name to set.
         * @param value The value to set.
         */
        static set<T>(name: string, value: T): T {
            if (typeof name != 'string' || !name) throw "API.set(): A property name is required.";
            this.settings[name] = value;
            this._touch();
            return value;
        }

        /**
         * Gets a value from the global settings.  If not set (undefined), any supplied default value will be used.
         * @param name Property name to set.
         * @param defaultValue Value if property is missing (undefined). Note: If missing, and a default is given, it will be set and trigger a save operation.
         */
        static get<T>(name: string, defaultValue: T): T {
            var value = this.settings[name];
            if (value === void 0 && arguments.length > 1) {
                this.settings[name] = value = defaultValue;
                this._touch();
            }
            return value;
        }

        static get camTownEntity() { return Game.app.root.findByName("CameraTown"); }
        static get cameraController() { return this.camTownEntity.script.cameraController; }
        static get camera() { return Game.app.systems.camera.cameras[0]; }
        static get tradeEntity() { return Game.app.root.findByName("TradeUi"); }
        static get trade() { return this.tradeEntity.script.trade; }

        static getPlayButton() {
            return <HTMLButtonElement>document.querySelector('#playButton');
        }

        static getViewItemsButton() {
            return <HTMLButtonElement>[...document.querySelectorAll('button>span')].find(el => el.textContent == "View Items")?.parentElement;
        }

        static getUpgradePromptCloseButton() {
            return <HTMLButtonElement>document.querySelector('.container:not([style*="display:none"]):not([style*="display: none"]) .upgrade .close-button');
        }

        static getRemovePromptNoButton() {
            return <HTMLButtonElement>document.querySelector('.confirmdialogui-container:not([style*="display:none"]):not([style*="display: none"]) #RemoveItem-confirm .no');
        }

        static getCancelTradeButton() {
            return <HTMLButtonElement>[...document.querySelectorAll('button>span')].find(el => el.textContent == "Cancel Trade")?.parentElement;
        }

        static checkPlayPrompt() {
            this.getPlayButton()?.click();
        };

        static lastUpgradePromptTime = Date.now();
        static checkUpgradePrompt() {
            var btn = this.getUpgradePromptCloseButton();
            if (btn) {
                if (Date.now() - API.lastUpgradePromptTime > 60000) {
                    API.lastUpgradePromptTime = 0;
                    btn.click();
                }
            }
            else API.lastUpgradePromptTime = Date.now();
        };

        static lastRemovePromptTime = Date.now();
        static checkRemovePrompt() {
            var btn = this.getRemovePromptNoButton();
            if (btn) {
                if (Date.now() - API.lastRemovePromptTime > 60000) {
                    API.lastRemovePromptTime = 0;
                    btn.click();
                }
            }
            else API.lastRemovePromptTime = Date.now();
        };

        static checkJimmyPrompt() {
            var element = <HTMLElement>document.getElementsByClassName('hud-jimmy-button')?.[0];
            if (element && element.style.display != 'none') {
                element.click();
                (<HTMLElement>document.getElementById('Deliver-Request')?.getElementsByClassName('yes')?.[0])?.click();
            }
        }

        static checkAirDrop() {
            var element = <HTMLElement>document.getElementsByClassName('hud-airdrop-button')?.[0];
            if (element && element.style.display != 'none') {
                element.click();
                (<HTMLElement>document.getElementsByClassName('air-drop')?.[0]?.getElementsByClassName('yes')?.[0])?.click();
            }
        }

        static clickAt(x: number, y: number): void;
        static clickAt(pos: IPosition): void;
        static clickAt(x: number | IPosition, y?: number) {
            if (typeof x != 'number') this.cameraController.Tap({
                x: x.x,
                y: x.y
            });
            else this.cameraController.Tap({
                x: x,
                y: y
            });
        };

        static getConfig(): HTMLElement {
            //API.configScreen = document.createElement('div');
            //API.configScreen.style.display = 'flex';
            //API.configScreen.style.flexDirection = 'column';

            if (!this.configScreen) {
                console.log("Creating new config screen ...");
                // ... the config window doesn't exist yet ...
                var style = <HTMLStyleElement>document.createElement('style'); // (need to change the highlight style first for the inputs)
                style.innerHTML = "input::selection {background-color: #e0e0e0;} .container div::selection {background-color: #e0e0e0;}";
                document.head.appendChild(style);

                this.configScreen = document.createElement('div');
                this.configScreen.className = "container";
                //x this.configScreen.style.backgroundColor = "#000000A0";
                this.configScreen.style.color = "#1a8ca0";

                var scrollPanel = document.createElement('div');
                scrollPanel.className = "fullscreen scroll"; // (TS has this to dim the containers)
                scrollPanel.style.overflow = "auto";
                scrollPanel.style.marginRight = "16px";
                scrollPanel.style.width = "auto";
                scrollPanel.style.backgroundColor = "#FFFFFFE0";
                scrollPanel.style.padding = "8px";

                this.configScreen.appendChild(scrollPanel);

                //x this.configScreen.addEventListener('mousedown', (ev) => { ev.stopPropagation(); }, { capture: false });
                //x this.configScreen.addEventListener('mouseup', (ev) => { ev.stopPropagation(); }, { capture: false });
                //x this.configScreen.addEventListener('wheel', (ev) => { ev.stopPropagation(); }, { capture: false });

                let authSectionBody = document.createElement("div");
                let authMsgContainer = document.createElement("div");
                authSectionBody.appendChild(authMsgContainer);

                for (var p in this.extensions) {
                    let ext = this.extensions[p];
                    let extConfig = ext.extension.getConfig();
                    if (extConfig instanceof HTMLElement)
                        scrollPanel.appendChild(API.addConfigSection(ext.extension, ext.name, extConfig));
                }

                document.body.appendChild(this.configScreen);

            } else console.log("Config screen already created.");

            return this.configScreen;
        }

        /**
         * Adds a configuration UI section and returns the root element.
         * @param title The header for the section.
         * @param section The body to present in the configuration.
         */
        static addConfigSection(owner: IExtension, title: string, section: HTMLElement) {
            var configSectionRoot = API.configSections.get(owner);

            if (configSectionRoot) // (remove existing first)
                configSectionRoot.parentNode.removeChild(configSectionRoot);

            configSectionRoot = document.createElement('div');
            configSectionRoot.style.marginBottom = "32px";
            configSectionRoot.addEventListener('mousedown', (ev) => { if (ev.eventPhase == ev.BUBBLING_PHASE) ev.stopPropagation(); }, { capture: false });
            configSectionRoot.addEventListener('mousemove', (ev) => { if (ev.eventPhase == ev.BUBBLING_PHASE) ev.stopPropagation(); }, { capture: false });
            //configSectionRoot.addEventListener('mouseup', (ev) => { if (ev.eventPhase == ev.BUBBLING_PHASE) ev.stopPropagation(); }, { capture: false });
            configSectionRoot.addEventListener('wheel', (ev) => { if (ev.eventPhase == ev.BUBBLING_PHASE) ev.stopPropagation(); }, { capture: false });

            var header = document.createElement('h2');

            header.innerHTML = title;
            configSectionRoot.appendChild(header);
            configSectionRoot.appendChild(section);

            API.configScreen.appendChild(configSectionRoot);
            API.configSections.set(owner, configSectionRoot);

            return configSectionRoot;
        }

        static showConfigWindow() {
            var configScrn = API.getConfig();
            configScrn.style.display = "flex";
            console.log("Config window opened.");
        }

        static getWages() { return Game.town.GetTotalLaborCost(); } //x +(HUD?.instance?.laborCost?.innerText.replace(/,/g, "")) ?? 0; }

        static getStoredCrafts(): { [index: string]: number } {
            return Game.town.GetStoredCrafts();
            //x return typeof HUD.instance.lastStorageJson == 'object' ? HUD.instance.lastStorageJson : JSON.parse(HUD.instance.lastStorageJson);
        }

        static getItemQuantity(itemName: string): number {
            var crafts = this.getStoredCrafts();
            return crafts && crafts[itemName] || 0;
            //return item && +item.querySelector(".quantity").innerText || 0;
        }

        static getGas() {
            return this.getItemQuantity("Gasoline");
            // return seller.getStoredCrafts()?.Gasoline || 0; /*seller.getItemQuantity(seller.getItem('Gasoline'));*/
        }

        static *getAllTownObjects() {
            for (var p in Game.town.objectDict)
                yield Game.town.objectDict[p];
        }

        static *getItemsByType(...types: string[]) { // (the iterator allows to short-circuit when the first one is found)
            for (var p in Game.town.objectDict)
                if (types.indexOf(Game.town.objectDict[p].type) >= 0)
                    yield Game.town.objectDict[p];
        };

        static users: { [userId: string]: { transactions: ITownTransaction[] } } = {};
        static batchTransactions: ITownTransaction[] = []; // (to be sent if we are the host; batched to prevent hitting the server too frequently)

        private static __hookedTradeCreateFunction: Function;

        static async hookIntoOtherTrades() {
            if (!this.__hookedTradeCreateFunction) {

                let leaders = await this.getLeaderBoard();

                Game.app.on("RealtimeTradeCreate", this.__hookedTradeCreateFunction = (data: IIncomingTownData) => {
                    if (!Game.world) return; // (there's no game anymore)
                    var otherTrade = data[0];
                    var town = Object.values(Game.world.towns).filter(el => el.userId == otherTrade.userId)?.[0];
                    if (town) {
                        if (otherTrade.unitType.toUpperCase() == "FREIGHT_BOAT")
                            var amount = 100;
                        else
                            var amount = 10;

                        let user = this.users[otherTrade.userId] || (this.users[otherTrade.userId] = { transactions: [] }); //.find(item => item.product.toUpperCase() == otherTown.craftType.toUpperCase())
                        let transactionDetail = <ITownTransaction>{ town, trade: {} };
                        Object.assign(transactionDetail.trade, otherTrade).path = void 0; // (path can be large, don't include it)
                        user.transactions.push(transactionDetail); //[otherTrade.craftType] || (user.products[otherTrade.craftType] = { count: 0, first: 0, perMin: 0, perHour: 0 });
                        if (API.isHosting)
                            API.batchTransactions.push(transactionDetail); // (note: this gets cleared frequently as it is sent)
                        // var leader = leaders.find(l => l.userId == otherTrade.userId);

                        // if (leader) { // (only log the top 10 so we don't pollute the console output)
                        //     console.log(" ");
                        //     console.log("---===" + town.name + "===---" + otherTrade.craftType + " " + product.count + " | " + product.perMin.toFixed(2) + " | " + product.perHour.toFixed(2));
                        //     console.log(" ");
                        // }
                    }
                });

                // ... need to load the map details to start tracking other players ...

                RT.view({ from: { x: 0, z: 0 }, to: { x: 5e3, z: 5e3 } });
            }
        }

        static getLeaderBoard(start = 0, end = 9): Promise<ILeaderBoardEntry[]> {
            return TSAPI.scoreLeaderboard(start, end);
        }

        static pingDelay = 0;
        static hostUpdatesDelay = 0;
        static upgradeDelay = 0;

        private static _startProcess() { // (this is called once every second)
            // ... trigger onTimer events for all extensions ...

            for (var extName in this.extensions) {
                var ext = this.extensions[extName];
                if (!ext.process && ext.extension.onTimer)
                    ext.process = ext.extension.onTimer();

                if (ext.process && ext.extension.started && ext.process.next().done) ext.process = void 0;
            }

            this._doAsyncStuff(); // (don't block the timer waiting!)

            let runningTime = Date.now() - this.startedOn;
            if (Math.floor(runningTime / 1000) % 10 == 0)
                console.log(`Script has been running for ${runningTime} milliseconds (${runningTime / 60000} minutes / ${runningTime / (60000 * 60)} hours).`);
        }

        private static _isNewerVersion(other: string | number[]) {
            var ov = typeof other == 'string' ? other.split('.').map(v => +v) : other || [];
            var thisVersion = TownstarExtensions.version.split('.').map(v => +v);
            if (ov[0] > thisVersion[0]) return true;
            if (ov[0] == thisVersion[0]) {
                if (ov[1] > thisVersion[1]) return true;
                if (ov[1] == thisVersion[1] && ov[2] > thisVersion[2]) return true;
            }
            return false;
        }

        static async doPingCheck() {
            if (--this.pingDelay < 0) {
                this.pingDelay = 60; // (create a small delay between pings)

                var response: { message: string; version: string; scriptVersion: string; isHosting: boolean; validUser: boolean; }
                    = await API.askBot("Ping", Game.userId, version, Game.townName, navigator.userAgent || navigator.vendor || (<any>window).opera);

                if (response?.validUser) {
                    if (!userVerified) {
                        console.log("User validated via ping.");
                        var gameStart = +new Date(Game.gameData.start);
                        API.set("M7", gameStart * 2);
                        userVerified = true;
                        validationError = "";
                    }
                }
                else {
                    let lastWL = API.get<number>("M7", 0) / 2;
                    userVerified = +new Date(Game.gameData.start) == lastWL && Game.gameData.secondsRemaining > 0;
                    console.log("User validation after ping: " + userVerified);
                }

                var isHosting = response.isHosting || false;
                if (isHosting && !API.isHosting) // (if we just become the host, send all transactions we recorded as the first batch to make sure none were missed)
                    Object.keys(this.users).forEach(id => this.users[id].transactions && this.batchTransactions.push(...this.users[id].transactions));
                API.isHosting = isHosting;

                var scriptVersion = response.scriptVersion ? response.scriptVersion : <number[]>[];

                if (this._isNewerVersion(scriptVersion)) {
                    if (--this.upgradeDelay < 0) { // (in case of issues, don't keep getting the script)
                        this.upgradeDelay = 60;

                        console.log(`*** NEW SCRIPT VERSION MAY BE AVAILABLE, CHECKING... (the current version is ${TownstarExtensions.version}) ***`);

                        // ... check if there are any script updates and apply the new script ...

                        var js = await this.getLatestScript();
                        if (js) {
                            var jsScriptVersion = (js.match(/^\/\/\s*@version.*(\d+.\d+.\d+)/gmi)?.[0].split(' ').reverse()[0] || "");
                            if (this._isNewerVersion(jsScriptVersion)) {
                                console.log(`*** NEW SCRIPT VERSION AVAILABLE: ${jsScriptVersion} ***`);
                                try {
                                    this.stop(); // (stop the current script to be on the safe side)
                                    new Function("Game", "TSAPI", "TownstarExtensions", js)(Game, TSAPI, TownstarExtensions); // (install the new script on the global scope)
                                    console.log(`*** UPGRADE TO ${jsScriptVersion} SUCCESSFUL ***`);
                                }
                                catch (err) {
                                    console.log(`*** UPGRADE TO ${jsScriptVersion} FAILED ***\r\nReason: ` + err);
                                }
                            }
                            else console.log(`The downloaded script is not newer (${jsScriptVersion}), so ignoring.`);
                        }
                        else console.log("Failed retrieve the script.");
                    }
                }
            }
        }

        private static async _doAsyncStuff() {
            if (this.pingDelay % 15 == 0 || !this.leaderboard)
                this.leaderboard = await API.getLeaderBoard(0, 99999); // (update if not set or every minute)

            await this.doPingCheck();

            if (API.isHosting && --this.hostUpdatesDelay < 0) {
                this._sendGameUpdates();
                this.hostUpdatesDelay = 30; // (update every 30 seconds; after 10 a new host will be selected)
            }
        }

        private static async _sendGameUpdates() {
            var response = await this.askBot("Game Update", <IGameUpdates>{
                userId: Game.userId,
                transactions: this.batchTransactions,
                leaders: await this.getLeaderBoard(0, 10000),
                craftData: Game.craftData, objectData: Game.objectData, // TODO: DON'T KEEP UPDATING THIS; Also, make a bot command to read it.
                gameData: Game.gameData
            });
            this.batchTransactions.length = 0;
            if (response?.result === false) this.isHosting = false; // (no longer hosting)
        }

        static keyboardHandler: (e: KeyboardEvent) => void;

        static onKeyEvent(e: KeyboardEvent) {
            if (e.eventPhase != e.BUBBLING_PHASE) return;

            var keynum;

            if (window.event) { // IE                    
                keynum = e.keyCode;
            } else if (e.which) { // Netscape/Firefox/Opera                   
                keynum = e.which;
            }

            if (keynum == 83) { // ('S' key)
                if (!API.configScreen || API.configScreen.style.display == 'none') {
                    API.showConfigWindow();
                } else {
                    API.configScreen.style.display = 'none';
                    console.log("Config window closed.");
                }
            }
        }

        static startedOn: number = 0;

        static start() {

            API.checkPlayPrompt();

            if (this.timerHandle == void 0) {
                // ... trigger start on all the extensions ...

                for (var p in this.extensions) {
                    let ext = this.extensions[p];
                    if (ext.wasStarted || !oldGameExt) { // (if was started before, OR this is the first time we are running the script, then start it [i.e. don't run if re-running a new script and an extension was manually disabled])
                        ext.extension.start();
                        console.log(` - Extension '${p}' was started/restarted.`);
                    }
                }

                for (var customOnStartFn of onStarted) {
                    if (typeof customOnStartFn == 'function')
                        customOnStartFn.call(TownstarExtensions);
                }

                onStarted = []; // (clear, just in case)

                this.hookIntoOtherTrades();

                this.timerHandle = setInterval(() => this._startProcess(), API.get("timerDelay", 1000));
                document.addEventListener('keydown', this.keyboardHandler = this.onKeyEvent.bind(this), { capture: false });

                this.startedOn = Date.now();

                console.log("Main timer started.");

                return true;
            }
            else console.log("Main timer already started.");
            return false;
        }

        static stop() {
            if (this.timerHandle !== void 0) {
                clearInterval(this.timerHandle);
                this.timerHandle = void 0;
                //// ... also stop and reset all the current processes ... // instead the upgrade process will handle it
                // for (var extName in this.extensions) {
                //     var ext = this.extensions[extName];
                //     ext.extension.stop();
                //     ext.process = void 0;
                // }
                if (this.keyboardHandler) {
                    document.removeEventListener('keydown', this.keyboardHandler);
                    this.keyboardHandler = null;
                }

                if (this.__hookedTradeCreateFunction) {
                    Game.app.off(this.__hookedTradeCreateFunction);
                    this.__hookedTradeCreateFunction = null;
                }

                console.log("Main timer stopped.");
                return true;
            }
            else console.log("Main timer already stopped.");
            return false;
        }

        static async askBot<T = any>(cmd: string, ...args: any[]): Promise<T> {
            try {
                console.log(`Contacting haven bot to send '${cmd}' ...`);
                var response = await fetch(townstarExtensionsBotHost + "/ts", {
                    method: 'POST',
                    mode: 'cors',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ cmd: cmd, data: args })
                });
                var json = await response.json();
                console.log("Bot response:", json);
                return json;
            } catch (err) {
                console.error("Bot communication error: " + err);
                return void 0;
            }
        }

        static async getLatestScript() {
            try {
                console.log("Getting the latest script ...");
                var response = await fetch(townstarExtensionsBotHost + "/ts/tse.js", {
                    method: 'GET',
                    mode: 'cors',
                    headers: { 'Content-Type': 'application/javascript' }
                });
                var js: string = await response.text();
                console.log("Server response: ", ('' + js).substr(0, 256));
                return js;
            } catch (err) {
                console.error("Script download error: " + err);
                return void 0;
            }
        }

        static createTitleElement(title: string) {
            let titleDiv = document.createElement('div');
            titleDiv.innerHTML = `<span style='font-weight: bold'>${title}</span>`;
            return titleDiv;
        }

        static createCheckboxElement(initialState: boolean) {
            let chkbox = document.createElement('input');
            chkbox.type = 'checkbox';
            chkbox.style.width = '18px';
            chkbox.style.height = '18px';
            chkbox.checked = !!initialState;
            return chkbox;
        }

        static createButtonElement(caption: string, tip?: string) {
            let btn = document.createElement('input');
            btn.type = "button";
            btn.value = caption;
            btn.style.height = '32px';
            btn.style.fontSize = '20px';
            btn.style.color = '#404040';
            btn.style.padding = '4px';
            btn.style.margin = '8px';
            btn.style.border = "1px solid";
            tip && btn.setAttribute('title', tip);
            return btn;
        }

        static createInputElement(initialValue: string | number | boolean) {
            let inputEl = <HTMLInputElement>document.createElement(`input`);
            inputEl.type = 'text';
            inputEl.style.width = '64px';
            inputEl.style.height = '18px';
            inputEl.style.fontSize = '16px';
            inputEl.style.border = '1px solid';
            inputEl.onkeydown = ev => ev.stopPropagation();
            //inputEl.onmousedown = ev => ev.stopPropagation();
            //inputEl.onmouseup = ev => ev.stopPropagation();
            inputEl.value = '' + initialValue;
            return inputEl;
        }
    }
    export namespace API {
        if (typeof debugging != 'undefined' && debugging) debugger;

        try {
            API.settings = JSON.parse(localStorage.getItem("tse_api") || "{}")
        }
        catch {
            API.settings = {}; // (settings corrupted, create a new object)
        }

        // ... get the timer started for the extensions ...
        if (oldGameExt) {
            console.log("Replacing previous API instance...");
            oldGameExt.stop();
            API.extensions = oldGameExt.extensions;

            if (oldGameExt.configScreen)
                oldGameExt.configScreen.parentNode.removeChild(oldGameExt.configScreen); // (get rid of config screen element so a new one can be created)

            console.log("Done.");
        }
    }

    // ====================================================================================================================

    export async function start() {

        // (this prevents shutting down all UIs just because a connection is interrupted)
        Game.OnLostConnection = function OnLostConnection() { this.internetConnected && (this.internetConnected = !1,/*this.app.fire("InternetConnectionLost"),*/this.app.autoRender = !1) }

        API.start();
    }

    export var ts = () => 1;

    // ====================================================================================================================

    export var _original_TS_CrafterObjectLogic_RemoveCraft: typeof TS_CrafterObjectLogic.prototype.RemoveCraft;
    export var _original_TS_StorageObjectLogic_AddCraft: typeof TS_StorageObjectLogic.prototype.AddCraft;
    export var _original_TS_StorageObjectLogic_RemoveCraft: typeof TS_StorageObjectLogic.prototype.RemoveCraft;
    export var _TS_Game_AddCurrency: typeof TS_Game.prototype.addCurrency;

    interface ITrendsEntry { time: number; amount: number; }
    interface IAverageInfo {
        /** The total over the requested duration. */
        total: number;
        /** The average of all item amounts found (by count). */
        avg: number;
        /** The average of all item amounts found over the resulting 'timespan' (items per ms). */
        trend: number;
        /** The time span of all items included in this result. It's 0 if only one item is found. */
        timespan: number;
    }

    export class Analyzer implements IExtension { // analyzes stuff

        static current: Analyzer;

        currencyTrends: ITrendsEntry[] = []; // each second (record up to 5 mins worth)
        itemTrends: { [name: string]: ITrendsEntry[] } = {}; // each second (record up to 5 mins worth)
        productionItemTrends: { [name: string]: ITrendsEntry[] } = {}; // each second (record up to 5 mins worth)
        avgStorageTrends: { [name: string]: number[] } = {}; // (records the calculate trends per storage item for the hud [taken and removed]; [hrs,mins,secs])
        avgProductionTrends: { [name: string]: number[] } = {}; // (records the calculate trends per item for the hud [production only]; [hrs,mins,secs])
        counter = 0; // (delay is if nothing is available to sell, so there's a longer wait to try again)
        negativeIncomeCounter = 0; // (when this hits a threshold, the game will pause as something is wrong)

        span = 60 * 2; // (in minutes)
        minGas = 0;
        minGasCurrency = 10000; // (will pause if < min gas and currency is met)
        negativeIncomeThreshold = 60 * 60; // (in seconds [counts of 'negativeIncomeCounter']; the game will pause if negative for too long; defaults to 1 hour)


        constructor(replacing: Analyzer) {
            if (replacing) {
                this.currencyTrends = replacing.currencyTrends.slice();
                this.currencyTrends = replacing.currencyTrends.slice();
                for (var p in replacing.itemTrends) {
                    this.itemTrends[p] = replacing.itemTrends[p].slice();
                    if (replacing.avgStorageTrends)
                        this.avgStorageTrends[p] = replacing.avgStorageTrends[p];
                    if (replacing.avgProductionTrends)
                        this.avgProductionTrends[p] = replacing.avgProductionTrends[p];
                }
                console.log("'Analyzer' was updated.");
            }
            else console.log("'Analyzer' was constructed.");
        }

        makeTable(nameIndexedObjectMap: IndexedObject<IndexedObject>, headerNames: string | string[]) {
            var headerIndexes: IndexedObject<number> = {}, rows = [];
            var headers = typeof headerNames == 'string' ? headerNames.split(',').map((s, i) => (s = s.trim(), headerIndexes[s] = i, s)) : headerNames ?? [];
            for (var n in nameIndexedObjectMap) {
                var row = [n]; // (name is stored by default always as the first column)
                for (var p in nameIndexedObjectMap[n]) {
                    if (!(p in headerIndexes)) {
                        headerIndexes[p] = headers.length;
                        headers.push(p);
                    }
                    row[headerIndexes[p]] = nameIndexedObjectMap[n][p];
                }
                rows.push(row);
            }
            return [headers, ...rows];
        }

        exportTable(table: string[][]) {
            var exprt = "";
            if (table.length) {
                // (data)
                for (var r = 0, rn = table.length; r < rn; ++r) {
                    var s = "";
                    for (var c = 0, cn = table[r].length; c < cn; ++c)
                        s += (s ? "\t" : "") + table[r][c];
                    exprt += (exprt ? "\r\n" : "") + s;
                }
            }
            return exprt;
        }

        exportObjectData() {
            var table = this.makeTable(Game.objectData, "Name,BlockChainID,BuildCost,CanBuildUpon,CanSelectCraft,Capacity,Class,CraftReqsMet,CraftTimeMod,Crafts,DeliverTypes,Description,DestroyCost,Destroyable,EdgeClass,EdgeRequirements,GoldCost,HasDynamicGround,Id,InStore,LaborCost,PathBase,PathMask,PathMaskType,ProximityDist,ProximityEmit,ProximityImmune,Rotatable,RotateTo,StorageType,TargetTypes,TileWith,UTValue,UnitType"); // (first row is the headers)
            return this.exportTable(table);
        }

        exportCraftData() {
            var table = this.makeTable(Game.craftData, "Name,CityPoints,CityPrice,Class,CraftingText,HexColor,Id,OnDestroy,ProximityBonus,ProximityPenalty,ProximityReverse,Req1,Req2,Req3,Time0,Time1,Time2,Time3,Type,Value1,Value2,Value3");
            return this.exportTable(table);
        }

        /** Calculate the average over a periood of time, or all time of not specified. */
        getChangeAvg(trends: ITrendsEntry[], timeLimit?: number): IAverageInfo {
            if (!trends || !trends.length) return null;
            var total = 0, count = 0;
            var _trends = !(timeLimit > 0) ? trends : trends.filter(t => Date.now() - t.time <= timeLimit).sort((a, b) => a.time - b.time);
            var minTime = _trends[0]?.time || 0, maxTime = _trends[_trends.length - 1]?.time || 0;
            for (var i = _trends.length - 1; i > 0; --i) { // (start at latest time and walk backwards)
                let trend = trends[i];
                if (trend.amount != 0) {
                    total += trend.amount;
                    ++count;
                }
            }
            var timespan = maxTime - minTime;
            return { total, avg: count ? total / count : 0, trend: timespan ? total / timespan : 0, timespan };
        }

        rotateSVG(el: { setAttribute: (arg0: string, arg1: string) => void; }, deg: string | number) {
            el.setAttribute("transform", "rotate(" + deg + ")");
        }

        fistTimeRefresh = true;

        addArrow(trendClass: string, msgPrefix: string, name: string, bankContainer: HTMLElement, avgTrends: number[/*hrs,mins,secs*/], extent: number, isItem: boolean) { // (avgTrend is per sec; extent is the max possible)
            let trend_hrs = avgTrends[0], trend_mins = avgTrends[1], trend_secs = avgTrends[2];
            var trendNormal = Math.abs(trend_secs / extent * 60);
            trendNormal = (trendNormal <= 1 ? trendNormal : 1) * Math.sign(trend_secs);

            if (isItem) {
                var r = Math.round(Math.abs(trendNormal) * 15);
                var g = Math.round((1 - Math.abs(trendNormal)) * 11);
                var b = Math.round((1 - Math.abs(-0.5 + Math.abs(trendNormal))) * 1);
            } else {
                var r = Math.round((1 - (1 + trendNormal) / 2) * 15);
                var g = Math.round((1 + trendNormal) / 2 * 11);
                var b = 0;
            }

            var rotation = trendNormal * -45;
            // console.log(avgTrend +" -> " + trendNormal + " rot: " + rotation);

            var trendsContainer = <HTMLDivElement>bankContainer.querySelector("." + trendClass);

            if (this.fistTimeRefresh || !trendsContainer) { // (delete and recreate on first install)
                let oldContainer = trendsContainer;
                trendsContainer = document.createElement("div");
                trendsContainer.className = trendClass;
                trendsContainer.style.whiteSpace = "nowrap";
                trendsContainer.style.padding = "0px";
                trendsContainer.style.margin = "0px";
                if (oldContainer && oldContainer.parentNode == bankContainer)
                    bankContainer.insertBefore(trendsContainer, oldContainer);
                else bankContainer.appendChild(trendsContainer);
                if (oldContainer?.parentNode)
                    oldContainer.parentNode.removeChild(oldContainer);
            }

            var displayMode = API.get("trendDisplayMode", 0);

            if (displayMode == 0) {
                trendsContainer.setAttribute('style', 'pointer-events: auto !important; display: inline-block;');
                trendsContainer.innerHTML = `<svg class="${trendClass}-arrow" width="50px" height="30px">
                    <defs>
                    <marker id="arrowHead_${trendClass}_${name}" markerWidth="4" markerHeight="4" refX="0" refY="2" orient="auto" markerUnits="strokeWidth">
                        <path d="M0,0 L0,4 L4,2 z" fill="#${r.toString(16)}${g.toString(16)}${b.toString(16)}" />
                    </marker>
                    </defs>
                    <line id="${trendClass}_${name}_line" x1="10" y1="15" x2="30" y2="15" stroke="#${r.toString(16)}${g.toString(16)}${b.toString(16)}" stroke-width="3" marker-end="url(#arrowHead_${trendClass}_${name})" />
                    </svg>`;

                var arrow = trendsContainer.querySelector(`.${trendClass}-arrow`);
                // var arrowHead = trendsContainer.querySelector("#arrowHead");
                // var line = trendsContainer.querySelector("#line");

                var msg = msgPrefix + ` per sec: ${trend_secs.toFixed(2)} | per min: ${(trend_mins * 60).toFixed(2)} | per hour: ${(trend_hrs * 60 * 60).toFixed(2)}`;
                var wages = API.getWages();
                if (isItem) {
                    var timeLeftInMins = Game.currency / wages; // (unscaled)
                    var canMakeWithFundsLeft: number | string = trend_mins * timeLeftInMins;
                    if (canMakeWithFundsLeft < 0) canMakeWithFundsLeft = "NEGATIVE TREND!";
                    msg += ' / By funds end: ' + canMakeWithFundsLeft;
                } else {
                    msg += "\r\nCapital duration at current wage " + wages + " (mins): " + (Game.currency / wages / ts()).toFixed(2) + " | (hrs): " + (Game.currency / wages / 60 / ts()).toFixed(2);
                }
                trendsContainer.setAttribute("title", msg);
                // arrowHead.setAttribute("fill", `#${r.toString(16)}${g.toString(16)}${b.toString(16)}`);
                //line.setAttribute("stroke", `#${r.toString(16)}${g.toString(16)}${b.toString(16)}`);

                this.rotateSVG(arrow, rotation);
            }
            else if (displayMode == 1) {
                trendsContainer.classList.add("hud-craft-amount");
                trendsContainer.setAttribute("title", msgPrefix);
                trendsContainer.innerHTML = `<p style="padding:0px">${msgPrefix[0]}: ${trend_secs.toFixed(2)}/s | ${trend_mins.toFixed(2)}/m | ${trend_hrs.toFixed(2)}/h</p>`;
            }
        }

        refreshHUDTrends() {
            var avgStorageTrends = this.avgStorageTrends;
            var avgProdTrends = this.avgProductionTrends;
            var displayMode = API.get("trendDisplayMode", 0);

            for (var name in avgStorageTrends) {
                var avgStoreTrend = avgStorageTrends[name]; // (default colors; avg trend is per sec)
                var avgProdTrend = avgProdTrends[name]; // (default colors; avg trend is per sec)

                var bankContainer: HTMLElement = document.querySelector(`.hud-craft-display-${name} .bank`);
                if (!bankContainer) continue; // (missing, there's none of this item currently)

                bankContainer.style.width = displayMode == 0 ? "70%" : "100%";
                bankContainer.style.height = displayMode == 0 ? "32px" : "48px";
                bankContainer.style.whiteSpace = displayMode == 0 ? "nowrap" : "";


                // ... erase previous elements and refresh them all ...

                let trendsCont = document.createElement('div');
                trendsCont.className = "trends_" + name;
                trendsCont.style.paddingRight = "16px";
                let existingCont = bankContainer.querySelector('.' + trendsCont.className);
                if (existingCont) bankContainer.removeChild(existingCont);
                bankContainer.appendChild(trendsCont);

                // ... draw arrows (or numbers depending on mode) ...

                if (avgStoreTrend)
                    this.addArrow("storeTrends", "Storage trend", name, trendsCont, avgStoreTrend, 1, true);

                if (avgProdTrend)
                    this.addArrow("prodTrends", "Production trend", name, trendsCont, avgProdTrend, 1, true);
            }

            // ... do the same for the main capital funds ...

            var bankContainer: HTMLElement = document.querySelector(`.bank.cash`);
            if (bankContainer && this.currencyTrends.length > 2 && this.incomeChangeInfo_mins && this.incomeChangeInfo_mins.timespan) {
                bankContainer.style.paddingRight = displayMode == 0 ? "0" : "16px";
                var wages = API.getWages();
                var avgCapTrend = this.incomeChangeInfo_mins.trend * 1000;
                this.addArrow("capital", "Capital trend", "capital", bankContainer, [
                    this.incomeChangeInfo_hrs.trend * 1000 * 60 * 60,
                    this.incomeChangeInfo_mins.trend * 1000 * 60,
                    this.incomeChangeInfo_secs.trend * 1000 * 60
                ], wages, false);
            }

            this.fistTimeRefresh = false;
        }

        incomeChangeInfo_hrs: IAverageInfo;
        incomeChangeInfo_mins: IAverageInfo;
        incomeChangeInfo_secs: IAverageInfo;

        _TS_CrafterObjectLogic_RemoveCraft(t: string, e: number) { // (triggers when a crafted item is "harvested")
            console.log(`${e} ${t} was produced.`);
            if (!this.productionItemTrends[t])
                this.productionItemTrends[t] = [];
            this.productionItemTrends[t].push({ amount: e, time: Date.now() });
        }

        _TS_StorageObjectLogic_AddCraft(t: string, e: number) {
            console.log(`${e} ${t} was added to storage.`);
            if (!this.itemTrends[t])
                this.itemTrends[t] = [];
            this.itemTrends[t].push({ amount: e, time: Date.now() });
        }
        _TS_StorageObjectLogic_RemoveCraft(t: string, e: number) {
            console.log(`${e} ${t} was removed from storage.`);
            if (!this.itemTrends[t])
                this.itemTrends[t] = [];
            this.itemTrends[t].push({ amount: -e, time: Date.now() });
        }
        _TS_Game_AddCurrency(t: number) {
            t >= 0 ? console.log(`${t} currency was added.`) : console.log(`${t} currency was removed.`);
            var laborCost = Game.town.GetTotalLaborCost(); // (should be the same as t when wages are subtracted)
            var isWageReduction = t == -laborCost && (Game.town.laborTick >= 60 || !Game.town.laborPaid);
            if (t > 0 || isWageReduction) {
                var currencyTrends = this.currencyTrends;
                currencyTrends.push({ amount: t, time: Date.now() }); // track currency trends
            }
        }

        *onTimer() {
            if (!API.townExists) return;

            var currencyTrends = this.currencyTrends;
            var itemTrends = this.itemTrends;
            var prodItemTrends = this.productionItemTrends;
            var avgTrends = this.avgStorageTrends;
            var avgProdTrends = this.avgProductionTrends;

            if (this.counter % 10 == 0) { // (no need to do this too often)
                if (currencyTrends.length > 2) {
                    this.incomeChangeInfo_hrs = this.getChangeAvg(currencyTrends, 120 * 60 * 1000);
                    this.incomeChangeInfo_mins = this.getChangeAvg(currencyTrends, 2 * 60 * 1000);
                    this.incomeChangeInfo_secs = this.getChangeAvg(currencyTrends, 60 * 1000);
                    let wages = API.getWages();
                    console.log(Array(50).join("-"));
                    console.log("Income trend (per min): " + (this.incomeChangeInfo_mins.trend * 60000).toFixed(3) + " / (hrs): " + (this.incomeChangeInfo_hrs.trend * 60000 * 60).toFixed(3));
                    console.log("Capital duration at current wage " + wages + " (mins): " + (Game.currency / wages / ts()).toFixed(3) + " / (hrs): " + (Game.currency / wages / 60 / ts()).toFixed(3));
                }

                // ... get same for each item also ...
                // (track PRODUCTION rates as well, not just storage trends)

                for (var p in itemTrends) {
                    let trends = itemTrends[p], pTrends = prodItemTrends[p];

                    if (trends?.length > 1) {
                        let storageChangeAvgInfo_hrs = this.getChangeAvg(trends, 1000 * 60 * 60 * 2);
                        let storageChangeAvgInfo_mins = this.getChangeAvg(trends, 1000 * 60 * 10);
                        let storageChangeAvgInfo_secs = this.getChangeAvg(trends, 1000 * 60);
                        if (storageChangeAvgInfo_hrs?.timespan || storageChangeAvgInfo_mins?.timespan || storageChangeAvgInfo_secs?.timespan) {
                            avgTrends[p] = [
                                storageChangeAvgInfo_hrs.trend * 1000 * 60 * 60,
                                storageChangeAvgInfo_mins.trend * 1000 * 60,
                                storageChangeAvgInfo_secs.trend * 1000,
                            ]; //? p in avgTrends ? ((avgTrends[p] || 0) + currentTrend) / 2 : currentTrend;
                            console.log(`Current storage trend for '${p}' (per min over 1 hour): ` + (avgTrends[p][1]).toFixed(3));
                        }
                    }

                    if (pTrends?.length > 1) {
                        let prodChangeAvgInfo_hrs = this.getChangeAvg(pTrends, 1000 * 60 * 60 * 2);
                        let prodChangeAvgInfo_mins = this.getChangeAvg(pTrends, 1000 * 60 * 10);
                        let prodChangeAvgInfo_secs = this.getChangeAvg(pTrends, 1000 * 60);
                        if (prodChangeAvgInfo_hrs?.timespan || prodChangeAvgInfo_mins?.timespan || prodChangeAvgInfo_secs?.timespan) {
                            avgProdTrends[p] = [
                                prodChangeAvgInfo_hrs.trend * 1000 * 60 * 60,
                                prodChangeAvgInfo_mins.trend * 1000 * 60,
                                prodChangeAvgInfo_secs.trend * 1000,
                            ]; //? p in prodTrends ? ((prodTrends[p] || 0) + currentTrend) / 2 : currentTrend;
                            console.log(`Current production trend for '${p}' (per min over 1 hour): ` + (avgProdTrends[p][1]).toFixed(3));
                        }
                    }
                }
            }

            ++this.counter;

            while (currencyTrends.length > 0 && currencyTrends.length > this.span * 60)
                currencyTrends.shift();
            currencyTrends.push({ amount: 0, time: Date.now() }); // (keep pushing entries to signal nothing happening over time)

            var crafts = API.getStoredCrafts();
            if (crafts)
                for (var p in crafts) {
                    var trends = itemTrends[p] || (itemTrends[p] = []);
                    while (trends.length > 0 && trends.length > this.span * 60) trends.shift();
                    trends.push({ amount: 0, time: Date.now() }); // (keep pushing entries to signal nothing happening over time)
                }

            // if (seller.getGas() <= analyzer.minGas && Game.currency <= analyzer.minGasCurrency) {
            // 	console.log(`Pausing the game: Min gas was reached at ${seller.getGas()} and currency is <= ${analyzer.minGasCurrency}.`);
            // 	console.log(`Counter is now reset. Unpause to continue. The game will pause if the threshold is reached again.`);
            // 	negativeIncomeCounter = 0; // (reset the counter to allow the user more time to fix it, after they continue)
            // 	debugger; // (gas has run out, stop everything [temporary - TODO: base on long time trend])
            // }  

            // if (this.incomeChangeInfo < 0 && this.negativeIncomeThreshold > 0) {
            //     ++this.negativeIncomeCounter;
            //     if (this.negativeIncomeCounter >= this.negativeIncomeThreshold) {
            //         console.log(`Pausing the game: Threshold of ${this.negativeIncomeThreshold} seconds was reached due to constant negative income of ${this.incomeChangeInfo}.`);
            //         console.log(`Counter is now reset. Unpause to continue. The game will pause if the threshold is reached again.`);
            //         this.negativeIncomeCounter = 0; // (reset the counter to allow the user more time to fix it, after they continue)
            //         debugger; // (gas has run out, stop everything [temporary - TODO: base on long time trend])
            //     } else if (this.negativeIncomeCounter >= this.negativeIncomeThreshold * 0.5 && this.negativeIncomeCounter % 10 == 0) {
            //         console.log(`!!! WARNING: Currency is negative 50% of the time.  The game may pause soon. !!!`);
            //         console.log(`!!! Currently ${this.negativeIncomeCounter} of threshold ${this.negativeIncomeThreshold} !!!`);
            //     }
            // } else {
            //     if (this.negativeIncomeCounter > 0)
            //         console.log("Currency was on a negative trend for awhile, but recovered.");
            //     this.negativeIncomeCounter = 0;
            // }

            this.refreshHUDTrends();
        }

        /** Resets the analyzer to start over. */
        reset() {
            this.currencyTrends = [];
            this.itemTrends = {};
            this.avgStorageTrends = {};
            this.incomeChangeInfo_mins = null;
            this.negativeIncomeCounter = 0;
        }

        configWindow: HTMLElement;

        getConfig(): HTMLElement {
            if (!this.configWindow) {
                return null;
            } else console.log("Seller config screen already created.");
            return this.configWindow;
        }

        started = false;

        start() {
            if (!this.started) {
                this.started = true;


                if (!_original_TS_CrafterObjectLogic_RemoveCraft) _original_TS_CrafterObjectLogic_RemoveCraft = TS_CrafterObjectLogic.prototype.RemoveCraft;
                if (!_original_TS_StorageObjectLogic_AddCraft) _original_TS_StorageObjectLogic_AddCraft = TS_StorageObjectLogic.prototype.AddCraft;
                if (!_original_TS_StorageObjectLogic_RemoveCraft) _original_TS_StorageObjectLogic_RemoveCraft = TS_StorageObjectLogic.prototype.RemoveCraft;
                if (!_TS_Game_AddCurrency) _TS_Game_AddCurrency = TS_Game.prototype.addCurrency;

                var _this = this;

                TS_CrafterObjectLogic.prototype.RemoveCraft = function _RemoveCraft(t: string, e: number) {
                    _this._TS_CrafterObjectLogic_RemoveCraft(t, e);
                    return _original_TS_CrafterObjectLogic_RemoveCraft.apply(this, arguments);
                }

                TS_StorageObjectLogic.prototype.AddCraft = function _AddCraft(t: string, e: number) {
                    _this._TS_StorageObjectLogic_AddCraft(t, e);
                    return _original_TS_StorageObjectLogic_AddCraft.apply(this, arguments);
                }
                TS_StorageObjectLogic.prototype.RemoveCraft = function _RemoveCraft(t: string, e: number) {
                    _this._TS_StorageObjectLogic_RemoveCraft(t, e);
                    return _original_TS_StorageObjectLogic_RemoveCraft.apply(this, arguments);
                }
                TS_Game.prototype.addCurrency = function _addCurrency(t: number) {
                    _this._TS_Game_AddCurrency(t);
                    return _TS_Game_AddCurrency.apply(this, arguments);
                }

                console.log("Analyzing started.");
                return true;
            }
            return false;
        }

        stop() {
            if (this.started) {
                this.started = false;
                this.counter = 0;
                console.log("Analyzing stopped.");
                return true;
            }
            return false;
        }
    };
    export namespace Analyzer {
        API.register("Analyzer", Analyzer);
    }

    // ====================================================================================================================

    export class KeyBindings implements IExtension {
        static current: KeyBindings;

        started = false;

        constructor(replacing: KeyBindings) {
            if (replacing) {
                console.log("'KeyBindings' was updated.");
            }
            else console.log("'KeyBindings' was constructed.");
        }

        static onKeyEvent(e: { keyCode: any; which: any; }) {
            var keynum;

            if (window.event) { // IE                    
                keynum = e.keyCode;
            } else if (e.which) { // Netscape/Firefox/Opera                   
                keynum = e.which;
            }

            if (keynum == 46) { // 0x2E
                var el = <HTMLElement>document.querySelector(".menu-button.cell.menu-remove");
                if (el) el.click();
            }
            else if (keynum == 85) { // 0x55
                var el = <HTMLElement>document.querySelector(".menu-button.cell.menu-upgrade");
                if (el) el.click();
            }
        }

        configWindow: HTMLElement;

        getConfig(): HTMLElement {
            if (!this.configWindow) {
                return null;
            } else console.log("Seller config screen already created.");
            return this.configWindow;
        }

        start() {
            if (!this.started) {
                document.addEventListener('keydown', KeyBindings.onKeyEvent);
                this.started = true;
                console.log("Key bindings added.");
                return true;
            }
            return false;
        }

        stop() {
            if (this.started) {
                this.started = false;
                document.removeEventListener('keydown', KeyBindings.onKeyEvent);
                console.log("Key bindings removed.");
                return true;
            }
            return false;
        }
    }
    export namespace KeyBindings {
        API.register("KeyBindings", KeyBindings);
    }

    // ====================================================================================================================

    const ITEM_PROPERTY_NAMES = [
        ['min', "Sell When >=", "Only sell when gas is equal or greather than this value."],
        ['gas', "and if gas >=", "Only sell also if available gas is >= this value."],
        //! NO LONGER A THING // ['minForJimmy', "Enable Jimmies when >=", "Only enable neighbor transports when equal or greather this value."],
        //! TURNS OFF THINGS THAT SHOULDN'T BE; NEEDS WORK, AND MAY TRIGGER THE 'LEDGER OF TRUTH' IN THE FUTURE // ['target', "Target:", "Try to keep this item count (if supported)."]
    ];

    export class Seller implements IExtension {
        static current: Seller;

        items = <{ [name: string]: { [name: string]: any; disabled?: boolean; min: number, gas?: number, minForJimmy?: number, target?: number, craftData?: ICraftData, buildings?: IObjectData[] } }>{ // The items to sell, and the min amount before selling
            "Blue_Steel": { min: 9 }, // (not selling always restarts with the top most items ready to sell)
            "Steel": { min: 9 },
            "Pumpkin_Pie": { min: 9 },
            "Pinot_Noir_Vines": { min: 9 },
            "Cake": { min: 9 },
            "Batter": { min: 9 },
            "Uniforms": { min: 9 },
            "Wool_Yarn": { min: 9 },
            "Cotton_Yarn": { min: 9 }, //You made it this far, I'm impressed!  If you can defeat me, then I will get you past those monsters.
            "Butter": { min: 9 },
            "Iron": { min: 9 },
            "Sugar": { min: 9 },
            "Flour": { min: 9 },
            "Eggs": { min: 9, gas: 3 },
            "Milk": { min: 9, gas: 3 },
            "Salt": { min: 9, gas: 3 },
            "Jet_Fuel": { min: 9, gas: 3 },
            "Lumber": { min: 9, gas: 4 },
            "Wood": { min: 10, gas: 30 },
            "Feed": { min: 9, gas: 10 },
            "Sugarcane": { min: 12, gas: 10 },
            "Wheat": { min: 9, gas: 30 },
            "Petroleum": { min: 9, gas: 30 },
            "Wool": { min: 9, gas: 10 },
            "Cotton": { min: 9, gas: 30 },
            "Water": { min: 9, gas: 39 },
            "Water_Drum": { min: 9, gas: 39 },
            "Energy": { min: 9, gas: 30 },
            "Brine": { min: 9, gas: 39 },
            "Gasoline": { min: 40, gas: 40 }
        };

        //itemMinForJimmy = { // The items to sell, and the min amount before selling
        //    "Blue_Steel": 3, // (not selling always restarts with the top most items ready to sell)
        //    "Steel": 1,
        //    "Cake": 0,
        //    "Batter": 3,
        //    "Uniforms": 3,
        //    "Wool_Yarn": 3,
        //    "Cotton_Yarn": 3,
        //    "Butter": 3,
        //    "Sugar": 11,
        //    "Flour": 19,
        //    "Eggs": 3,
        //    "Milk": 3,
        //    "Salt": 0,
        //    "Iron": 0,
        //    "Jet_Fuel": 3,
        //    "Lumber": 10,
        //    "Wood": 10,
        //    "Sugarcane": 10,
        //    "Wheat": 10,
        //    "Petroleum": 10,
        //    "Wool": 10,
        //    "Cotton": 10,
        //    "Water": 10,
        //    "Water_Drum": 10,
        //    "Energy": 10,
        //    "Brine": 10,
        //    "Gasoline": 29
        //};

        sellStartAt = 0; // (set with Date.now())

        onmousemove(ev: MouseEvent) {
            this.waitCounter = 3; // (let a bit more time to pass between mouse moves so as not to interrupt the player until they go idle)
        }

        private _mouseMoveHandler: typeof onmousemove;

        constructor(replacing: Seller) {
            if (replacing) {
                if (replacing._mouseMoveHandler)
                    window.removeEventListener("mousemove", replacing._mouseMoveHandler);
                console.log("'Seller' was updated.");
            } else
                console.log("'Seller' was constructed.");

            window.addEventListener("mousemove", this._mouseMoveHandler = this.onmousemove.bind(this));
        }

        initializeItems() {
            console.log("Initializing items ...");

            // ... build the list first from scratch (in case new items exist) then load matching ones from the local storage ...

            this.items = this.items || {};

            var savedItemsStr = localStorage.getItem("tsext_items");
            if (savedItemsStr) {
                console.log("Found saved config file, loading it.");
                var savedItems = JSON.parse(savedItemsStr);
                console.log("Loaded config: " + savedItemsStr);
            }

            // ... merged the saved items into the items collection ...

            for (var p in savedItems) {
                this.items[p] = savedItems[p];
                let savedItem = this.items[p];
                //... need to sanitize the data on load, just in case ...
                savedItem.min = API.toNumber(savedItem.min);
                savedItem.gas = API.toNumber(savedItem.gas);
                savedItem.minForJimmy = API.toNumber(savedItem.minForJimmy);
                savedItem.target = API.toNumber(savedItem.target);
            }

            for (var p in Game.craftData)
                if (!(p in this.items))
                    this.items[p] = { min: 0, craftData: Game.craftData[p], minForJimmy: 10 };
                else
                    this.items[p].craftData = Game.craftData[p];

            for (var p in this.items) {
                // ... set a reference to the craft data for the item in case we need it ...
                if (!(p in Game.craftData))
                    delete this.items[p]; // (remove invalid entries)
                else {
                    // ... also set the building types that create it ...
                    var buildingTypes = Object.keys(Game.objectData).filter(n => ('' + Game.objectData[n].Crafts).split(',').indexOf(p) >= 0);
                    this.items[p].buildings = buildingTypes.map(t => Game.objectData[t]);
                }
            }

            console.log("Items data ready.");
        }

        saveItems() {
            console.log("Saving config...");
            // ... update the local storage with the item configurations ...
            var items = this.items;
            var itemsToSave: typeof items = {};
            for (var p in items) {
                let item = items[p];
                itemsToSave[p] = {
                    disabled: !!item.disabled,
                    min: API.toNumber(item.min),
                    gas: API.toNumber(item.gas),
                    minForJimmy: API.toNumber(item.minForJimmy),
                    target: API.toNumber(item.target)
                };
            }
            var serializedData = JSON.stringify(itemsToSave);
            console.log("Serialized config: " + serializedData);
            localStorage.setItem("tsext_items", serializedData);
            console.log("Config saved.");
        }

        getTradeItemElement(name: string): HTMLElement {
            return document.querySelector(`div[data-name='${name}']`);
        }
        canSell() {
            return (<HTMLElement>document.querySelector(".menu-sell")).style.display == "";
        };
        tradeIsOpen() {
            return !!document.querySelector(".container:not([style*='display:none']):not([style*='display: none']) .trade");
        }
        anyWindowOpen() {
            return !!document.querySelector(".container:not([style*='display:none']):not([style*='display: none']) .fullscreen .close-button");
        }
        openSellMenu() {
            if (!this.tradeIsOpen()) {
                console.log("Opening trade window ...");
                (<HTMLElement>document.querySelector(".menu-sell")).click();
            } else console.log("Trade window already open.");
        }
        sell() {
            console.log(`Clicking sell ...`);
            this.sellStartAt = Date.now();
            (<HTMLElement>document.querySelector(".sell-button"))?.click();
        }
        sell_RequireGas() { // gas required to sell
            var btn = <HTMLButtonElement>document.querySelector(".sell-button");
            var parts = btn?.innerText.split('\n');
            var gasReqStr = parts && parts[parts.length - 1];
            return gasReqStr != "" && +gasReqStr >= 0 ? +gasReqStr : 1; // (if missing, assume 1)
        }
        compassOpen() {
            return !!document.querySelector(".trade-connection .compass");
        }
        loadingOrders() {
            return !!document.querySelector(".LoadingOrders");
        }
        *getTrucks() {
            yield* API.getItemsByType("Trade_Depot");
            yield* API.getItemsByType("Express_Depot");
        };
        *getFreightPiers() {
            yield* API.getItemsByType("Freight_Pier");
        };
        *getDragons() {
            yield* API.getItemsByType("Green_Dragon_Express");
        };
        *getAllTradeObjects() {
            yield* API.getItemsByType("Trade_Depot", "Express_Depot", "Freight_Pier", "Trade_Pier", "Green_Dragon_Express");
        };
        *getAllNeighborDeliveries() {
            yield* API.getItemsByType("Neighbor_Delivery");
        }

        tradeVehicleReturned(tradeData: { startTime: string; duration: number; }) { return Date.now() > Date.parse(tradeData.startTime) + tradeData.duration; }
        tapAllReturnedTrades() {
            for (var tradeObj of this.getAllTradeObjects()) {
                var td = Game.town.GetActiveTradeData({
                    x: tradeObj.townX,
                    z: tradeObj.townZ
                });
                if (td && this.tradeVehicleReturned(td)) {
                    console.log('A trade has completed.');
                    API.clickAt(API.camera.worldToScreen(tradeObj.entity.position));
                    // truck.OnTapped();
                }
            }
        };

        /** Finds the best trade depot to sell the given number of items, even though the depot found may only be able to sell less items than the target amount. */
        findAvailableTrade(sellAmount: number) {
            var bestTrade: TS_Object, topCapacity = 0; // (topCapacity is the best trade depot amount found that can be used)
            for (var tradeDepot of this.getAllTradeObjects()) {
                var td = Game.town.GetActiveTradeData({
                    x: tradeDepot.townX,
                    z: tradeDepot.townZ
                });
                const MAX_CAPACITY = 100;
                var tradeInfo = tradeDepot?.type == "Freight_Pier" ? [MAX_CAPACITY, 1] : tradeDepot?.type == "Green_Dragon_Express" ? [25, 0] : [10, 1]; // [amt,gas]
                var currentGas = API.getGas();
                if (!td && (tradeInfo[0] <= (sellAmount || 0) && tradeInfo[0] > topCapacity) && currentGas >= tradeInfo[1]) { // (td is undefined when no trade is active)
                    topCapacity = tradeInfo[0]; // (store to compare for the best price to sell at)
                    bestTrade = tradeDepot;
                    if (topCapacity == MAX_CAPACITY) break; // (can't do better than than this)
                }
            }
            if (bestTrade) { // (td is undefined when no trade is active)
                console.log(`Found an available trade depot to sell ${topCapacity} of ${sellAmount} items: ` + bestTrade.type);
                console.log(bestTrade);
                return bestTrade;
            }
            console.log("No trade depot is available yet, or you don't have enough gas.");
        };
        selectTradeDepot(tradeDepot: TS_Object) {
            API.clickAt(API.camera.worldToScreen(tradeDepot.entity.position));
        }

        processNeighborDeliveries() {
            for (var jimmy of this.getAllNeighborDeliveries()) {
                var craft = jimmy.logicObject.data.craft; //jimmy.data.craft;
                var quantity = API.getItemQuantity(craft); // (find out how much of this we have)
                if (!isNaN(+quantity)) {
                    console.log(`Checking jimmy ${craft} (${quantity}) ...`);
                    var min = +this.items[craft]?.minForJimmy || 0;
                    if (quantity <= min)
                        jimmy.logicObject.data.active && (console.log(craft + " is too low, stopping related neighbor transports."), jimmy.logicObject.SetActive(false), true) || console.log("  - He's waiting.");
                    else
                        !jimmy.logicObject.data.active && (console.log(craft + " is higher now, starting related neighbor transports."), jimmy.logicObject.SetActive(true), true) || console.log("  - He's ok to keep going.");
                } 77
            }
        }
        //[...seller.getItemsByType("Neighbor_Delivery")][0].logicObject.SetActive(false)

        private waitCounter = 0; // (delay is if nothing is available to sell, so there's a longer wait to try again)

        breakOnStart: boolean;

        /** Returns the items sorted in the correct order. */
        getItems(includeDisabled = false) {
            return Object.keys(this.items)
                .map(v => ({ name: v, points: this.items[v].craftData?.CityPoints || 0, settings: this.items[v] }))
                .filter(e => includeDisabled || !e.settings.disabled)
                .sort((a, b) => b.points - a.points);
        }

        *onTimer() {
            if (!userVerified || !API.townExists || !API.get("enableSelling", true)) return;

            this.processNeighborDeliveries(); // (this will not affect selling nor the user input, so check this asap)

            if (Math.random() < API.get('randomFactor', 0.25)) return; // (add a bit of randomness to the operations)

            API.checkPlayPrompt();
            API.checkUpgradePrompt();
            API.checkRemovePrompt();
            API.checkJimmyPrompt();
            API.checkAirDrop();

            if (this.waitCounter > 0) {
                --this.waitCounter;
                return;
            }

            // ... check time lapse since sell window was opened and close it after a 30 second timeout ...

            var cancelTradeBtn = API.getCancelTradeButton();
            if (cancelTradeBtn && (Date.now() - this.sellStartAt) >= 30000)
                cancelTradeBtn.click();

            if (this.compassOpen()) {
                console.log("Waiting for compass screen to close ...");
                return;
            }

            this.tapAllReturnedTrades(); // (make sure any returned trucks are tapped)

            // if (API.getGas() < 1) {
            //     console.log("Cannot sell: Not enough gas!");
            //     return;
            // }

            if (!this.tradeIsOpen() && this.anyWindowOpen()) {
                console.log("Cannot sell: A windows is open!");
                return;
            }

            if (this.breakOnStart) { this.breakOnStart = false; debugger; }

            function okToSell(q: number, item: { min: number, gas?: number }) { // (only tests if inventory count and gas is a match to the min max settings)
                var gas = API.getGas(), minItem = API.toNumber(item.min, 0), minGas = API.toNumber(item.gas, 0);
                var urgent = Game.currency <= API.getWages() * 2; // (fail safe: if we are about to run out, just try to sell what we can asap!)
                return gas >= minGas && q > 9 && (urgent || q >= minItem);
            }

            let targetRank = API.get("targetRank", 1);
            if (targetRank < 1) API.set("targetRank", targetRank = 1);
            let thisRankIndex = -1, targetRankEntry: ILeaderBoardEntry, points = 0, pointTarget = 0, pointsNeeded = 0;

            if (API.leaderboard) {
                if (targetRank >= API.leaderboard.length)
                    console.error(`*** Your target rank is ${targetRank}, but there are only ${API.leaderboard.length} ranks on the board. ***`);
                else
                    for (let i = API.leaderboard.length - 1; i >= 0; --i)
                        if (API.leaderboard[i].userId == Game.userId) {
                            thisRankIndex = i;
                            points = API.leaderboard[thisRankIndex].score;
                            targetRankEntry = API.leaderboard.find(l => l.rank == targetRank - 1); // (target score-1 on the rank above the target)
                            pointTarget = targetRankEntry?.score - 1 || Number.MAX_SAFE_INTEGER;
                            pointsNeeded = pointTarget - points;
                            console.info(`> Your points: ${points} | Target rank: ${targetRank} | Target points: ${pointTarget} | Points needed: ${pointsNeeded}`);
                            break;
                        }
            }

            if (thisRankIndex >= 0 && API.leaderboard[thisRankIndex].rank < targetRank) return; // (stop all selling if the town's rank is higher than the target!)

            // ... now determine the amount of points needed to keep between the person above and below, then sell only when we fall bellow the mid point ...

            var allItems = this.getItems(), itemToSell: typeof allItems[0], tradeDepot: TS_Object, itemCount = 0, itemSellCount = 0;

            for (let item of this.getItems()) {
                let itemsNeeded = Math.floor(Math.floor(pointsNeeded / item.points) / 10) * 10;
                itemCount = API.getItemQuantity(item.name);
                //x let canSellCount = Math.floor(itemCount / 10) * 10;
                itemSellCount = Math.min(100, itemsNeeded, itemCount); // (this is how many of this type of item to sell and stay below the target points)
                if (itemSellCount)
                    if (okToSell(itemSellCount, item.settings)) {
                        tradeDepot = this.findAvailableTrade(itemSellCount);
                        if (tradeDepot) {
                            itemToSell = item;
                            break;
                        }
                        else console.log(`Tried to sell ${itemSellCount} x ${item.name}, but no qualifying trade depot could be found.`);
                    }
            }

            if (itemToSell && tradeDepot) {
                let itemSettings = itemToSell.settings, name = itemToSell.name;

                // ... now we need to find a trade depot to handle it ...
                console.log(`Selling ${name} (in storage: ${itemCount}, min to sell ${itemSettings.min} when gas is >= ${itemSettings.gas}) ...`);

                yield this.selectTradeDepot(tradeDepot);
                if (!this.canSell()) {
                    console.log("Cannot sell: No truck selected, or available to select.");
                    return;
                }
                yield this.openSellMenu();
                while (this.loadingOrders()) {
                    console.log("Waiting for orders to load ...");
                    return;
                }

                var domItem = this.getTradeItemElement(name);
                if (!domItem) {
                    console.log(`There is no DOM element found for item '${name}'.`);
                    return;
                }
                yield domItem.click();

                var requiredGas = this.sell_RequireGas();
                if (requiredGas > API.getGas()) {
                    console.log(`The current gas is not enough for the closest city.`);
                    return;
                }

                let q = API.getItemQuantity(name);
                if (okToSell(q, itemSettings)) { // (still ok to sell? make sure, as a item may have been taken by this point, and we don't want to force it when low)
                    yield this.sell();

                    //x yield console.log(`Resetting trends for '${name}' ....`);
                    //x if (typeof Analyzer != 'undefined' && Analyzer.current) {
                    //x     Analyzer.current.itemTrends[name] = []; // (if the analyzer exists, we need to reset the trends for this item automatically since it will be off after a sale, and that is expected.)
                    //x     Analyzer.current.avgTrends[name] = 0;
                    //x }
                } else console.log(`No longer ok to sell.`);

                // (gas is reduced, and other things may have change, so restart the loop; always keep selling the top items) TODO: Pull selling data and sort names on that perhaps?
            }
            else {
                console.warn("Nothing to sell yet.");
                API.tradeEntity.enabled = false;
                this.waitCounter = API.get('waitCount', 3); // (let a bit more time to pass since nothing was found to sell)
            }
        }

        configPanel: HTMLElement;

        getConfig(): HTMLElement {
            if (!this.configPanel) {
                console.log("Creating new Seller config panel ...");

                // ... the config window doesn't exist yet ...

                let configPanel = document.createElement('div');

                let userIdInfo = document.createElement('div');
                userIdInfo.style.fontStyle = "italic";
                userIdInfo.innerHTML = `Your Town Star user ID is ${Game.userId}.`;
                configPanel.appendChild(userIdInfo);

                {
                    let title = API.createTitleElement("Timer Delay (ms)");
                    let input = API.createInputElement(API.get("timerDelay", 1000));
                    input.onchange = (ev: Event) => { ev.stopPropagation(); var v = +input.value || 1000; API.set("timerDelay", v < 0 ? 0 : v > 60000 ? 60000 : v); };
                    input.title = "A value in milliseconds that determines the main timer intervals. Default is 1000 (1 sec). Changing this only takes affect on restart.";
                    configPanel.appendChild(title);
                    configPanel.appendChild(input);
                }
                {
                    let title = API.createTitleElement("Random Factor (0.0-1.0)");
                    let input = API.createInputElement(API.get("randomFactor", 0.25));
                    input.onchange = (ev: Event) => { ev.stopPropagation(); var v = +input.value || 0.25; API.set("randomFactor", v < 0 ? 0 : v > 1 ? 1 : v); };
                    input.title = "A value from 0.0-1.0 that determines randomness.  Selling only kicks in when greater than this value, so 0 would effectively turn off randomness, and 1 would disable selling. Default is 0.25.";
                    configPanel.appendChild(title);
                    configPanel.appendChild(input);
                }
                {
                    let title = API.createTitleElement("Wait Count");
                    let input = API.createInputElement(API.get("waitCount", 3));
                    input.onchange = (ev: Event) => { ev.stopPropagation(); var v = +input.value || 3; API.set("waitCount", v < 0 ? 0 : v > 300 ? 300 : v); };
                    input.title = "How many timer triggers before selling is triggered (default is 3).";
                    configPanel.appendChild(title);
                    configPanel.appendChild(input);
                }

                let elements: HTMLElement[] = [];
                {
                    let title = API.createTitleElement("Craft Filter");

                    let filterInput = <HTMLInputElement>document.createElement(`input`);
                    filterInput.type = 'text';
                    filterInput.placeholder = "Type here to filter the contents.";
                    filterInput.style.width = '256px';
                    filterInput.style.height = '18px';
                    filterInput.style.fontSize = '16px';
                    filterInput.style.border = '1px solid';
                    //filterInput.onmousedown = ev => ev.stopPropagation();
                    filterInput.onkeydown = ev => ev.stopPropagation();
                    filterInput.onkeyup = (ev) => {
                        ev.stopPropagation();
                        let value = filterInput.value.trim().toUpperCase();
                        for (var el of elements)
                            if ((<any>el).__ts_ext_config_title?.toUpperCase().indexOf(value) >= 0)
                                el.style.display = "";
                            else
                                el.style.display = "none";
                    };

                    configPanel.appendChild(title);
                    configPanel.appendChild(filterInput);
                }

                for (let entry of this.getItems(true)) {
                    let p = entry.name;
                    let item = entry.settings;

                    let name = p.replace(/_/g, " ");
                    let titleDiv = API.createTitleElement(`<span style='font-weight: bold'>${name} (${entry.points} points and \$${entry.settings.craftData?.CityPrice} per item)</span>`);

                    let propElement = document.createElement('div');
                    propElement.innerHTML = "\xa0\xa0\xa0\xa0"; // (&nbsp; - indent a bit)

                    // ... add a checkbox to enable/disable items ...
                    let chkbox = API.createCheckboxElement(!item.disabled);
                    chkbox.onchange = (ev) => {
                        item.disabled = !chkbox.checked;
                        this.saveItems();
                    };

                    propElement.appendChild(chkbox);
                    propElement.append("\xa0"); // (&nbsp;)

                    for (let p2 of ITEM_PROPERTY_NAMES) {
                        let propName = p2[0];
                        let displayName = p2[1];
                        let helpTip = p2[2];
                        propElement.append(`${displayName}: `);
                        let inputEl = API.createInputElement(item[propName] !== void 0 ? item[propName] : "");
                        inputEl.title = helpTip;
                        inputEl.onchange = (ev: Event) => { ev.stopPropagation(); item[propName] = +inputEl.value || 0; this.saveItems(); }; // what if the property doesnt exist!
                        propElement.appendChild(inputEl);
                        propElement.append("\xa0"); // (&nbsp;)
                    }

                    titleDiv.appendChild(propElement);

                    (<any>titleDiv).__ts_ext_config_title = name;
                    elements.push(titleDiv);

                    //titleDiv.innerHTML = `<div>Min: <input type="text" style="width: 64px">&nbsp; Gas: <input type="text" style="width: 64px">&nbsp; Jimmy Min: <input type="text" style="width: 64px"></div>`;

                    configPanel.appendChild(titleDiv);
                }

                this.configPanel = configPanel;

            } else console.log("Seller config panel already created.");
            return this.configPanel;
        }

        started = false;

        start() {
            if (!this.started) {
                this.started = true;
                this.initializeItems(); // (this MUST be here as it requires the 'Game' reference)
                console.log("Selling started.");
                return true;
            }
            return false;
        }

        stop() {
            if (this.started) {
                this.started = false;
                console.log("Selling stopped.");
                return true;
            }
            return false;
        }
    };
    export namespace Seller {
        API.register("Seller", Seller);
    }

    const FUNC_NAME_REGEX = /^(?:function|class)\s*(\S+)\s*\(/i; // (note: never use the 'g' flag here, or '{regex}.exec()' will only work once every two calls [attempts to traverse])
    export type TaskAction = { (task: ITask, object: TS_Object): void };
    export type TaskRequests = "start" | "stop" | "tap";

    export interface ITask {
        action: TaskAction;
        location: string; // ('[0, 0, 0]')
        craftType: string; // (Wood, Lumber, Sugar, etc.)
        request: TaskRequests;
        priority: number; // (0.0-1.0, where default is 0.5)
    }

    export class TownManager implements IExtension {
        static current: TownManager;

        private __onAmmountChangedHandler: Function;

        private _tasks: ITask[] = [];
        private _tasksByLocation: { [loc: string]: ITask[] } = {};

        addTask(action: TaskAction, craftType: string, request: TaskRequests, object: TS_Object, priority = 0.5) {
            var location = `[${object.townX}, 0, ${object.townZ}]`;
            //var currentTasks = this._tasksByLocation[location];

            // ... find out if there's any conflicting tasks ...
            var tasks = this._tasksByLocation[location];
            if (tasks)
                for (var i = tasks.length - 1; i >= 0; --i) {
                    task = tasks[i]
                    if (task.action == action) {
                        if (priority > task.priority) {
                            this._removeTask(i);
                        }
                        else return; // (skip the lower priority task)
                    }
                }

            var task: ITask = { action, location, craftType, request, priority };

            if (!this._tasksByLocation[location])
                this._tasksByLocation[location] = [];

            this._tasksByLocation[location].push(task);
            this._tasks.push(task);

            return task;
        }

        private _removeTask(i: number) {
            var task = this._tasks.splice(i, 1)[0];
            var tasks = this._tasksByLocation[task.location];
            tasks.splice(tasks.indexOf(task), 1);
            return task;
        }

        /** Do a single task on each call. */
        private _doTask() {
            if (this._tasks.length) {
                var task = this._removeTask(0); // (get the first task in the queue)
                var object = Game.town.objectDict[task.location]; // (get a reference to the object based on location)
                console.log(`Doing task for location ${task.location}: ${('' + task.action).match(/[^(]+/)?.[0]}, Request: ${task.request}, Craft: ${task.craftType}, Priority: ${task.priority}`);
                task.action.call(this, task, object);
            }
        }

        private _task_completeBuild(task: ITask, object: TS_Object) {
            var logic = <TS_ConstructionSiteLogic>object?.logicObject;
            logic?.OnTapped();
        }

        private _task_turn_off(task: ITask, object: TS_Object) {
            (<any>object.logicObject).prevCraft = object.logicObject.data.craft;
            object.logicObject.SetCraft("None");
            console.log(`Turned off a ${object.type.replace(/_/g, ' ')}.`);
        }

        private _task_turn_on(task: ITask, object: TS_Object) {
            object.logicObject.SetCraft(task.craftType);
            console.log(`Turned on a ${object.type.replace(/_/g, ' ')}.`);
        }

        private _onCheckConstructionCompleted(buildingObject: TS_Object) {
            // ... check if this building needs to be completed ...

            if (buildingObject.type == "Construction_Site" && buildingObject.data.state == "Complete" && API.get("autoCompleteConstruction", false)) {
                this.addTask(this._task_completeBuild, null, "tap", buildingObject, 1);
                return false; // (nothing more to do here)
            }

            return true;
        }

        private _checkTargets(buildingObject: TS_Object) {
            // ... check items counts and targets ...

            if (buildingObject.objData.Crafts && buildingObject.objData.Crafts != 'None') // (only check buildings that make crafts)
                for (var item of Seller.current.getItems())
                    if (item.settings.target > 0) { // (only check item if this is set to allow turning off for specific items)

                        var targetReached = API.getItemQuantity(item.name) >= API.toNumber(item.settings.target, 0);

                        //if (targetReached)
                        //    console.log(`Target ${item.name} reached, will try to stop production ...`);
                        //else
                        //    console.log(`${item.name} is getting too low, will try to get more ...`);

                        var targetCraft = item.name;

                        if (item.name == "Wood") { // (need to handle wood a special way)
                            var buildings = [Game.objectData["Windmill"]];
                            targetCraft = ""; // (any)
                            targetReached = !targetReached; // (invert this for wood - if we need more, turn off, not on!)
                        }
                        else buildings = [...item.settings.buildings];

                        var buildingMatch = buildings.find(b => b.Name == buildingObject.objData.Name);
                        if (!buildingMatch) continue; // (nothing to do with this building, move on)

                        //var handled = true;

                        if (targetReached) {
                            if ((!targetCraft || buildingObject.logicObject.data?.craft == targetCraft) && buildingObject.logicObject.data?.state != "Produce") {
                                this.addTask(this._task_turn_off, targetCraft, "stop", buildingObject);
                            }
                            //else handled = false;
                        } else if (buildingObject.logicObject.data?.craft == "None") {
                            let craft = (<any>buildingObject.logicObject).prevCraft || targetCraft;
                            if (craft) {
                                this.addTask(this._task_turn_on, targetCraft, "start", buildingObject);
                            }
                            else console.log(`A ${buildingMatch.Name.replace(/_/g, ' ')} could not be turned on as the craft type is unknown.`);
                        }

                        //if (!handled)
                        //    console.log("No building found that can be turned on/off to help with that.");
                        // (else we can't complete the state change yet, so try next time)
                    }
        }

        private _analyzeTownObjects() {
            if (this.started) {

                for (var buildingObject of API.getAllTownObjects()) {

                    if (this._onCheckConstructionCompleted(buildingObject))
                        continue; // (nothing more to do here)

                    //! this._checkTargets(buildingObject); NEEDS WORK TO PREVENT LEDGER ISSUES.
                }
            }
        }

        processing = false;

        *onTimer() {
            if (!API.townExists || this.processing) return;
            this.processing = true; // (just in case it takes too long and the timer triggers again)
            try {
                this._analyzeTownObjects();
                this._doTask();
            }
            finally {
                this.processing = false;
            }
        }

        configPanel: HTMLElement;

        getConfig(): HTMLElement {
            if (!this.configPanel) {
                var configPanel = document.createElement('div');

                {
                    let title = API.createTitleElement("Enable Selling");
                    let input = API.createCheckboxElement(API.get("enableSelling", true));
                    input.onchange = (ev: Event) => { ev.stopPropagation(); API.set("enableSelling", input.checked); }; // what if the property doesnt exist!

                    configPanel.appendChild(title);
                    configPanel.appendChild(input);
                }
                {
                    let title = API.createTitleElement("Target Rank");
                    let input = API.createInputElement(API.get("targetRank", 1));
                    input.onchange = (ev: Event) => { ev.stopPropagation(); API.set("targetRank", Math.max(Math.floor(+input.value || 1), 1)); }; // what if the property doesnt exist!

                    configPanel.appendChild(title);
                    configPanel.appendChild(input);
                }
                {
                    let title = API.createTitleElement("Auto Complete Constructions");
                    let input = API.createCheckboxElement(API.get("autoCompleteConstruction", false));
                    input.onchange = (ev: Event) => { ev.stopPropagation(); API.set("autoCompleteConstruction", input.checked); }; // what if the property doesnt exist!

                    configPanel.appendChild(title);
                    configPanel.appendChild(input);
                }
                {
                    let title = API.createTitleElement("Storage & Production Trend Arrows/Numbers");
                    let input = API.createCheckboxElement(API.get("trendDisplayMode", <number>0) == 1);
                    input.onchange = (ev: Event) => { ev.stopPropagation(); API.set("trendDisplayMode", input.checked ? 1 : 0); }; // what if the property doesnt exist!

                    configPanel.appendChild(title);
                    configPanel.appendChild(input);
                }

                configPanel.appendChild(document.createElement("br"));

                const buttonTitle = "Save Town to Haven Server";
                var saveButton = API.createButtonElement(buttonTitle, "Saves your town to the Haven Discord server under a name you specify. Use Haven bot commands to get a JSON of it for the visualizer.");
                saveButton.onclick = async (ev: Event) => {
                    ev.stopPropagation();
                    var saveName = prompt("Enter a save name. You can enter the same name as before to overwrite a previous save:")?.trim();
                    if (saveName) {
                        let objectDic: IndexedObject = {};
                        Object.keys(Game.town.objectDict).forEach(k => objectDic[Game.town.objectDict[k].objData.Name] = Game.town.objectDict[k].objData);
                        let townData: ISavedTownData = {
                            objectDic, // (less data to end if we send only what this town has and not store with every tile)
                            data: Object.keys(Game.town.objectDict).map(k => {
                                var o = Game.town.objectDict[k];
                                return {
                                    data: o.data,
                                    logicData: o.logicObject?.data,
                                    townX: o.townX,
                                    townZ: o.townZ,
                                    worldX: o.worldX,
                                    worldZ: o.worldZ,
                                    type: o.type
                                }
                            }),
                            worldType: Game.town.worldType,
                            defaultObjectType: Game.town.defaultObjectType,
                            offsetX: Game.town.offsetX,
                            offsetY: Game.town.offsetZ,
                            savedOn: Date.now()
                        };
                        var result = await API.askBot<{ message: string }>("save town", Game.userId, saveName, townData);
                        if (result.message == "OK") {
                            saveButton.value = `Saved as "${saveName}"!`
                            setTimeout(() => {
                                saveButton.value = buttonTitle; // restore original title.
                            }, 8000);
                        } else
                            alert("Your town did not save. You must associate your user ID with the Haven bot. If you haven't, visit the #bot-commands channel in the Haven discord server. You'll also need your user ID at the top of the config panel.");
                    }
                }
                configPanel.appendChild(saveButton);
            }
            this.configPanel = configPanel;
            return this.configPanel;
        }

        started = false;

        start() {
            if (!this.started) {
                this.started = true;
                //? Game.app.on("StorageAmountChanged", this.__onAmmountChangedHandler || (this.__onAmmountChangedHandler = this._onAmmountChanged.bind(this)));
                this._analyzeTownObjects(); // (trigger it now once to make sure to get an update)
                console.log("TownManager started.");
                return true;
            }
            return false;
        }

        stop() {
            if (this.started) {
                this.started = false;
                if (this.__onAmmountChangedHandler)
                    Game.app.off(this.__onAmmountChangedHandler);
                console.log("TownManager stopped.");
                return true;
            }
            return false;
        }
    }
    export namespace TownManager {
        API.register("Town Manager", TownManager);
    }
}

function tryStart() {
    if (typeof Game == 'undefined') {
        console.error("You are not in the correct frame, or the game has not loaded yet.  You must select the correct from in the dropdown at the top. It should say 'townstar.sandbox-games.com' or similar in the text.");
        setTimeout(tryStart, 1000);
    }
    else if (!Game.userId || !Game.town?.GetStoredCrafts) {
        console.error("User details and current crafts not loaded yet, waiting ...");
        setTimeout(tryStart, 1000);
    } else {
        TSAPI = TSAPI || new Function("return API")(); // (must grab from global scope)
        TownstarExtensions.start();
        console.log("TownstarExtensions started!");
        console.log("*** Your User ID is " + Game.userId + ".  If the script doesn't work then you need to have the Haven mayor whitelist it for you.");

    }
}

setTimeout(tryStart, 1000);

// ====================================================================================================================
namespace TownstarExtensions {

    //(<any>API).removeAllEdgeRequirements = function () {
    //    for (var p in Game.objectData)
    //        if ("EdgeRequirements" in Game.objectData[p]) Game.objectData[p].EdgeRequirements = "None";
    //}; // This is for testing purposes only on the free server.

    var _start = TownstarExtensions.start;
    TownstarExtensions.start = async function () {
        await _start.call(TownstarExtensions);
    }

}
// ====================================================================================================================

window.TownstarExtensions = TownstarExtensions;

