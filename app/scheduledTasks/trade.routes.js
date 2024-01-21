"use strict";

module.exports = (app) => {
  const trade = require("../controllers/trade.controller.js");
  const draftpick = require("../controllers/draftpick.controller.js");
  const { logMemoryUsage } = require("../helpers/logMemoryUsage.js");

  setTimeout(async () => {
    await draftpick.sync(app);

    setInterval(async () => {
      if (app.get("syncing") === false) {
        const minute = new Date().getMinutes();

        if (minute % 10 === 0) {
          await draftpick.sync(app);
        } else {
          await trade.trades(app);
        }
        logMemoryUsage();
      } else {
        console.log("Skipping SYNC...");
      }
    }, 60 * 1000);
  }, 5000);
};
