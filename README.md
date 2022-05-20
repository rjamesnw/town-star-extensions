# Town Star Extensions
This repo contains a system for implementing extension scripts to the [Town Star](https://gala.fan/ZuShEZ3Ql) blockchain browser-based game.

Feel free to chat with support on the Discord server: https://discord.gg/ZTmMDHWpkN

Report issues/bugs on this Github repo, including requests, as they will not be tracked on Discord.

Sell script is deployed here for now: https://havenbot.ngrok.io/ts/tse.js

*Note: This script was only tested in Chrome or Brave browsers, because those were the only supported browsers for the game at the time; however, it should work on Edge as well. This script communicates with the Haven Discord Bot for the purpose of sending the global public data only (for stats reporting).  No private town data is ever sent to the server, unless you want to save the layout for the [visualizer](https://ts.litwiller.io/) (a manual process, not automatic).*

# Features

* Press S to open the sell config widow.
* Press Del to remove items.
* Press U to upgrade roads.
* The script will be running if you see the trend arrows appear (give it a couple seconds).
* You can hover your mouse over the arrows to see the trend details, which are also written to the console view if you leave it open.
* The system only sells when you stop moving the mouse.
* If you leave the console window open, the game will pause if there's a negative capital trend for more than 1 hour.
* If the capital <= wages*2, the game will ignore the min gas and sell whatever it can to get ahead as a last resort.
* The script will automatically collect the payment from the depots.
* You can now save your towns under a name (using the same name overwrites the previous save).  Press "s" and scroll to the bottom to see the save button. You can then go to #🤖bot-commands on the Haven Discord server and type `h.ts town`. The Haven bot will send a DM to you with your saved names. You can then run `h.ts town "save name"` in #🤖bot-commands and the bot will send you an export to a JSON you can use to import into the [visualizer](https://ts.litwiller.io/) (maintained on Github [here](https://github.com/Litwilly/townstar-visualizer)). To import, open the visualizer page and paste into the edit box at the bottom and click `Load`.\
\
The bot will not accept saves from non-whitelisted users. Open the game, press F12, go to the console tab, select 'townstar.sandbox-games.com' from the dropdown at the top, then enter `Game.userId` to get your ID. Visit the #🤖bot-commands channel on Haven's Discord and type `h.tsscript 1a2b3c...`, replacing `1a2b3c...` with your user ID. After that you'll be whitelisted and able to save your town.\
\
Note: There's another visualizer [here](https://kewlhwip.com/) to try in case the other doesn't work for you.

# Recommended Installation 
_(best for cases when Gala restarts the game after an update):_
 1. Download Tampermonkey Chrome/Brave extension.
 2. After the extension is installed, click on the icon in the extensions bar, select `Dashboard`, then click the `Utilities` tab.
 3. Paste the link above into "Import from URL", then click 'Install'; that's it! Enjoy. :wink:

# How to Install Manually

1. Run the Town Star game.
2. Press F12 to open the dev console.
3. Click to focus the console tab.
4. At the top left there's a dropdown to select frames (defaults to `top`). Select the frame with the name "townstar.sandbox-games.com" in it.
5. Paste this script into the console prompt and execute it (hit enter).

*Warning: this option only works until the game refreshes.*