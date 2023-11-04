'use strict'

const db = require("../models");
const User = db.users;
const League = db.leagues;
const Trade = db.trades;
const Op = db.Sequelize.Op;
const axios = require('../api/axiosInstance');
const Sequelize = db.Sequelize;
const sequelizse = db.sequelize;

const updateTrades = async (app, season, week) => {
    const updateTradesWeek = async (league, week_to_fetch, trades_league, trades_users) => {
        let transactions_league = await axios.get(`https://api.sleeper.app/v1/league/${league.league_id}/transactions/${week_to_fetch}`);

        transactions_league.data
            .filter(t => t.type === 'trade')
            .map(transaction => {
                const draft_order = league.drafts.find(d => d.draft_order && d.status !== 'complete')?.draft_order

                const managers = transaction.roster_ids.map(roster_id => {
                    const user = league.rosters?.find(x => x.roster_id === roster_id)

                    return user?.user_id
                })

                const draft_picks = transaction.draft_picks.map(pick => {
                    const roster = league.rosters.find(x => x.roster_id === pick.roster_id)
                    const new_roster = league.rosters.find(x => x.roster_id === pick.owner_id)
                    const old_roster = league.rosters.find(x => x.roster_id === pick.previous_owner_id)

                    return {
                        ...pick,
                        original_user: {
                            user_id: roster?.user_id,
                            username: roster?.username,
                            avatar: roster?.avatar,
                        },
                        new_user: {
                            user_id: new_roster?.user_id,
                            username: new_roster?.username,
                            avatar: new_roster?.avatar,
                        },
                        old_user: {
                            user_id: old_roster?.user_id,
                            username: old_roster?.username,
                            avatar: old_roster?.avatar,
                        },
                        order: draft_order && roster?.user_id && pick.season === season ? draft_order[roster?.user_id] : null
                    }
                })

                let adds = {}
                transaction.adds && Object.keys(transaction.adds).map(add => {
                    const user = league.rosters?.find(x => x.roster_id === transaction.adds[add])
                    return adds[add] = user?.user_id
                })

                let drops = {}
                transaction.drops && Object.keys(transaction.drops).map(drop => {
                    const user = league.rosters?.find(x => x.roster_id === transaction.drops[drop])
                    return drops[drop] = user?.user_id
                })

                const pricecheck = []
                managers.map(user_id => {
                    const count = Object.keys(adds).filter(a => adds[a] === user_id).length
                        + draft_picks.filter(pick => pick.new_user.user_id === user_id).length

                    if (count === 1) {
                        const player = Object.keys(adds).find(a => adds[a] === user_id)
                        if (player) {
                            pricecheck.push(player)
                        } else {
                            const pick = draft_picks.find(pick => pick.new_user.user_id === user_id)
                            pricecheck.push(`${pick.season} ${pick.round}.${pick.order}`)
                        }
                    }
                })



                trades_users.push(...managers.filter(m => parseInt(m) > 0).map(m => {
                    return {
                        userUserId: m,
                        tradeTransactionId: transaction.transaction_id
                    }
                }))

                trades_league.push({
                    transaction_id: transaction.transaction_id,
                    leagueLeagueId: league.league_id,
                    status_updated: transaction.status_updated,
                    rosters: league.rosters,
                    managers: managers,
                    players: [...Object.keys(adds), ...draft_picks.map(pick => `${pick.season} ${pick.round}.${pick.order}`)],
                    adds: adds,
                    drops: drops,
                    draft_picks: draft_picks,
                    drafts: league.drafts,
                    price_check: pricecheck
                })


            })
    }

    const week_to_fetch = week - (app.get('week_offset') || 0);


    let increment
    if (week === 1) {
        increment = 50
    } else {
        increment = 250
    }

    let leagues_to_update;

    let conditions = [
        { season: season },
        {
            settings: {
                disable_trades: 0
            }
        }
    ]

    let i = app.get('trades_sync_counter')

    if (week !== week_to_fetch) {
        i = 0;

        conditions.push(

            {
                [Op.not]: {
                    settings: { [Op.contains]: { trades_updated: [week_to_fetch] } }
                }

            }
        )
    }

    try {
        const leagues_db = await League.findAndCountAll({
            where: {
                [Op.and]: conditions
            },
            order: [['createdAt', 'ASC']],
            offset: i,
            limit: increment,
            raw: true
        })

        leagues_to_update = leagues_db.rows

        console.log({ count: leagues_db.count })

        console.log(`Updating trades for ${i + 1}-${Math.min(i + 1 + increment, i + leagues_to_update.length)} Leagues for WEEK ${week_to_fetch}...`)
    } catch (error) {
        console.log(error)
    }


    const trades_league = []
    const trades_users = []


    for (let j = 0; j < increment; j += 25) {
        await Promise.all(leagues_to_update.filter(l => l.rosters.find(r => r?.players?.length > 0)).slice(j, j + 25).map(async league => {

            try {
                await updateTradesWeek(league, week_to_fetch, trades_league, trades_users)

            } catch (error) {
                console.log(error.message)
            }

        }))
    }

    const leagues_updated_trades = leagues_to_update
        //    .filter(l => l.rosters.find(r => r?.players?.length > 0))
        .map(l => {
            const trades_updated = (l.settings.trades_updated || []).filter(w => w !== week_to_fetch);


            return {
                league_id: l.league_id,
                settings: {
                    ...l.settings,
                    trades_updated: [...trades_updated, week_to_fetch]
                }
            }
        })

    const trade_user_ids = trades_users.map(tu => {
        return {
            user_id: tu.userUserId
        }
    })

    try {
        await User.bulkCreate(trade_user_ids, { ignoreDuplicates: true });
        await League.bulkCreate(leagues_updated_trades, { updateOnDuplicate: ['settings'] });
        await Trade.bulkCreate(trades_league, { ignoreDuplicates: true });
        await db.sequelize.model('userTrades').bulkCreate(trades_users, { ignoreDuplicates: true });


    } catch (error) {
        console.log(error)
    }




    if (leagues_to_update.length < increment) {
        app.set('trades_sync_counter', 0)

        const week_offset = app.get('week_offset') || 0;

        if (week - 1 === week_offset) {
            app.set('week_offset', 0)
        } else {
            app.set('week_offset', week_offset + 1)
        }
    } else {
        app.set('trades_sync_counter', i + increment)
    }

}

exports.trades = async (app) => {
    app.set('syncing', true);

    console.log('Beginning Trade Sync...')

    const state = app.get('state')

    const week = state.season_type === 'regular' ? state.week : 1

    await updateTrades(app, state.season, week)

    app.set('syncing', false)
    console.log('Trade Sync Complete...')
}
