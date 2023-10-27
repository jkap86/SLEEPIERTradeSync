'use strict'

const db = require("../models");
const axios = require('../api/axiosInstance');
const fs = require('fs');

exports.boot = async (app) => {

    app.set('trades_sync_counter', 0);
    app.set('week_offset', 0);

    app.set('leagues_to_retry', []);

    app.set('syncing', false);

    const getState = async () => {
        const state = await axios.get('https://api.sleeper.app/v1/state/nfl')

        app.set('state', {
            ...state.data,
            display_week: Math.max(state.data.display_week, 1)
        }, 0)
    }

    await getState()


}