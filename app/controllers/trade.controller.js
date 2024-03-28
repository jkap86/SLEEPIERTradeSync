"use strict";

const db = require("../models");
const League = db.leagues;
const Trade = db.trades;
const Draft = db.drafts;
const Op = db.Sequelize.Op;
const axios = require("../api/axiosInstance");
const Sequelize = db.Sequelize;
const sequelize = db.sequelize;

exports.trades = async (app) => {
  app.set("syncing", true);

  console.log("Beginning Trade Sync...");

  const increment = 500;

  let counter = app.get("trades_sync_counter") || 0;

  const leagues = await getLeagues({ increment, counter });

  const batchSize = 25;

  for (let i = 0; i < leagues.length; i += batchSize) {
    try {
      const trades_batch = await getTrades({
        leagues: leagues.slice(i, i + batchSize),
        week_to_fetch: 1,
      });

      await Trade.bulkCreate(trades_batch, {
        updateOnDuplicate: ["draft_picks"],
      });
    } catch (err) {
      console.log(err.message);
    }
  }

  console.log({ counter });

  if (leagues.length < increment) {
    app.set("trades_sync_counter", 0);
  } else {
    app.set("trades_sync_counter", counter + increment);
  }

  app.set("syncing", false);
  console.log("Trade Sync Complete...");
};

const getTrades = async ({ leagues, week_to_fetch }) => {
  const trades_batch = await Promise.all(
    leagues
      .filter((league) => !league.rosters.find((roster) => !roster.players))
      .map(async (league) => {
        const transactions_league = await axios.get(
          `https://api.sleeper.app/v1/league/${league.league_id}/transactions/${week_to_fetch}`
        );

        return transactions_league.data
          .filter((t) => t.type === "trade")
          .map((transaction) => {
            const draft_order = league.drafts.find(
              (d) =>
                d.draft_order &&
                d.settings.rounds === league.settings.draft_rounds
            )?.draft_order;

            const managers = transaction.roster_ids.map((roster_id) => {
              const user = league.rosters?.find(
                (x) => x.roster_id === roster_id
              );

              return user?.user_id;
            });

            const draft_picks = transaction.draft_picks.map((pick) => {
              const roster = league.rosters?.find(
                (x) => x.roster_id === pick.roster_id
              );
              const new_roster = league.rosters?.find(
                (x) => x.roster_id === pick.owner_id
              );
              const old_roster = league.rosters?.find(
                (x) => x.roster_id === pick.previous_owner_id
              );

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
                order: draft_order ? draft_order[roster?.user_id] : null,
              };
            });

            let adds = {};
            transaction.adds &&
              Object.keys(transaction.adds).map((add) => {
                const user = league.rosters?.find(
                  (x) => x.roster_id === transaction.adds[add]
                );
                return (adds[add] = user?.user_id);
              });

            let drops = {};
            transaction.drops &&
              Object.keys(transaction.drops).map((drop) => {
                const user = league.rosters?.find(
                  (x) => x.roster_id === transaction.drops[drop]
                );
                return (drops[drop] = user?.user_id);
              });

            const pricecheck = [];
            managers.map((user_id) => {
              const count =
                Object.keys(adds).filter((a) => adds[a] === user_id).length +
                draft_picks.filter((pick) => pick.new_user.user_id === user_id)
                  .length;

              if (count === 1) {
                const player = Object.keys(adds).find(
                  (a) => adds[a] === user_id
                );
                if (player) {
                  pricecheck.push(player);
                } else {
                  const pick = draft_picks.find(
                    (pick) => pick.new_user.user_id === user_id
                  );
                  pricecheck.push(`${pick.season} ${pick.round}.${pick.order}`);
                }
              }
            });

            const rosters = {};
            transaction.roster_ids.forEach((roster_id) => {
              const roster = league.rosters.find(
                (r) => r.roster_id === roster_id
              );

              rosters[roster_id] = {
                user_id: roster.user_id,
                username: roster.username,
                avatar: roster.avatar,
                players: roster.players,
                draft_picks: roster.draft_picks,
              };
            });

            return {
              transaction_id: transaction.transaction_id,
              leagueLeagueId: league.league_id,
              status_updated: transaction.status_updated,
              rosters: rosters,
              managers: managers,
              players: [
                ...Object.keys(adds),
                ...draft_picks.map(
                  (pick) => `${pick.season} ${pick.round}.${pick.order}`
                ),
              ],
              adds: adds,
              drops: drops,
              draft_picks: draft_picks,
              price_check: pricecheck,
            };
          });
      })
  );

  return trades_batch.flat();
};

const getLeagues = async ({ increment, counter }) => {
  const leagues_db = await League.findAll({
    attributes: ["league_id", "settings", "rosters", "createdAt"],
    where: {
      settings: {
        disable_trades: 0,
      },
    },
    include: {
      model: Draft,
    },
    order: [["createdAt", "ASC"]],
    offset: counter,
    limit: increment,
  });

  return leagues_db;
};
