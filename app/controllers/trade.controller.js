'use strict'

const db = require("../models");
const League = db.leagues;
const Trade = db.trades;
const Op = db.Sequelize.Op;
const axios = require('../api/axiosInstance');

const updateTrades = async (app, season, week) => {
    const state = app.get('state')
    let i = app.get('trades_sync_counter')
    const increment = 250

    let leagues_to_update;
    try {
        leagues_to_update = await League.findAll({
            where: {
                [Op.and]: [
                    { season: season },
                    {
                        settings: {
                            disable_trades: 0
                        }
                    }
                ]
            },
            order: [['createdAt', 'ASC']],
            offset: i,
            limit: increment,
            raw: true
        })
    } catch (error) {
        console.log(error)
    }
    const week_to_fetch = week - (process.env.WEEK_OFFSET || 0);

    console.log(`Updating trades for ${i + 1}-${Math.min(i + 1 + increment, i + leagues_to_update.length)} Leagues for WEEK ${week_to_fetch}...`)

    const trades_league = []
    const trades_users = []

    let min = new Date().getMinutes()

    for (let j = 0; j < increment; j += 10) {
        await Promise.all(leagues_to_update.filter(l => l.rosters.find(r => r?.players?.length > 0)).slice(j, j + 25).map(async league => {

            try {
                const updateTradesWeek = async (week_to_fetch) => {
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

                    const oldest = Math.min(...transactions_league.data.map(trade => trade.status_updated), 0)


                    let older = Trade.count({
                        where: {
                            [Op.and]: [
                                { leagueLeagueId: league.league_id },
                                { status_updated: { [Op.lt]: parseInt(oldest) } }
                            ]
                        }
                    })

                    return older
                }

                let older = 0;
                let offset = 0;

                while (older === 0 && offset < week_to_fetch) {
                    older = await updateTradesWeek(week_to_fetch - offset);
                    offset++;
                }

            } catch (error) {
                console.log(error.message)
            }


        }))
    }


    try {
        await Trade.bulkCreate(trades_league, { ignoreDuplicates: true })
        await db.sequelize.model('userTrades').bulkCreate(trades_users, { ignoreDuplicates: true })

        /*
        const trades_deleted = await Trade.destroy({
            where: {
                status_updated: {
                    [Op.lt]: new Date().getTime() - 30 * 24 * 60 * 60 * 1000
                }
            }
        })
 
        console.log(`${trades_deleted} Trades deleted...`)
        */
    } catch (error) {
        console.log(error)
    }


    if (leagues_to_update.length < increment) {
        app.set('trades_sync_counter', 0)
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
