'use strict'

const { DataTypes } = require("sequelize");

module.exports = (sequelize, Sequelize) => {
    const TradeOld = sequelize.define("trades_old", {
        transaction_id: {
            type: Sequelize.STRING,
            allowNull: false,
            primaryKey: true
        },
        status_updated: {
            type: DataTypes.BIGINT
        },
        rosters: {
            type: Sequelize.JSONB,
        },
        managers: {
            type: DataTypes.ARRAY(DataTypes.STRING)
        },
        players: {
            type: DataTypes.ARRAY(DataTypes.STRING)
        },
        adds: {
            type: Sequelize.JSONB
        },
        drops: {
            type: Sequelize.JSONB
        },
        draft_picks: {
            type: Sequelize.JSONB
        },
        drafts: {
            type: Sequelize.JSONB
        },
        price_check: {
            type: Sequelize.JSONB
        }
    }, {
        freezeTableName: true,
        indexes: [
            {
                fields: [{ attribute: 'status_updated', operator: 'DESC' }],


            }
        ]
    });

    return TradeOld;
};