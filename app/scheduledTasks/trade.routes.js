'use strict'

module.exports = app => {
    const trade = require('../controllers/trade.controller.js');

    setTimeout(async () => {
        await trade.trades(app)
    }, 5000)

    setInterval(async () => {
        if (app.get('syncing') === false) {
            await trade.trades(app);

        } else {
            console.log('Skipping SYNC...')
        }
        const used = process.memoryUsage()
        for (let key in used) {
            console.log(`${key} ${Math.round(used[key] / 1024 / 1024 * 100) / 100} MB`);
        }
    }, 60 * 1000)


}