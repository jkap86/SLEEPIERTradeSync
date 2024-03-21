"use strict";

const { fetchDraftPicks } = require("../api/sleeperApi");
const db = require("../models");
const Op = db.Sequelize.Op;
const Draftpick = db.draftpicks;
const Draft = db.drafts;
const Auctionpick = db.auctionpicks;

const getActiveDrafts = async ({ increment, counter, cutoff }) => {
  console.log("Getting Draft IDs");

  const drafts_active = await Draft.findAll({
    order: [["createdAt", "ASC"]],
    offset: counter,
    limit: increment,
    where: {
      [Op.and]: [
        {
          [Op.or]: [
            {
              status: "drafting",
            },
            {
              status: "paused",
            },
            {
              [Op.and]: [
                {
                  status: "complete",
                },
                {
                  [Op.or]: [
                    {
                      createdAt: {
                        [Op.gt]: cutoff,
                      },
                    },
                    {
                      last_picked: {
                        [Op.gt]: cutoff,
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: { [Op.not]: "auction" },
        },
        {
          [Op.or]: [
            {
              [Op.and]: [
                {
                  settings: {
                    slots_super_flex: 1,
                  },
                },
                {
                  settings: {
                    slots_qb: 1,
                  },
                },
              ],
            },
            {
              settings: {
                slots_qb: 2,
              },
            },
            {
              settings: {
                slots_super_flex: 2,
              },
            },
          ],
        },
        {
          settings: {
            player_type: {
              [Op.not]: 1,
            },
          },
        },
      ],
    },
  });

  console.log({
    drafts_active_length: drafts_active.length,
  });

  return {
    drafts_active,
    leagues_dbLength: drafts_active.length,
  };
};

const getCompletedAuctions = async ({ increment, counter }) => {
  const auctions_complete = await Draft.findAll({
    order: [["createdAt", "ASC"]],
    offset: counter,
    limit: increment,
    where: {
      [Op.and]: [
        {
          status: "complete",
        },
        {
          type: "auction",
        },
      ],
    },
    include: {
      model: Draftpick,
      where: {
        draftDraftId: null,
      },
      required: false,
    },
  });

  return {
    auctions_complete,
    auctions_complete_length: auctions_complete.length,
  };
};

const getDraftPicks = async (drafts_active) => {
  const draft_picks_all = [];

  const batchSize = 5;

  for (let i = 0; i < drafts_active.length; i += batchSize) {
    await Promise.all(
      drafts_active.slice(i, i + batchSize).map(async (draft_active) => {
        try {
          const draft_picks_draft = await fetchDraftPicks(
            draft_active.draft_id
          );

          if (
            draft_picks_draft.find(
              (pick) => !parseInt(pick.metadata?.years_exp)
            ) ||
            draft_picks_draft.find((pick) => pick.metadata?.position === "K")
          ) {
            const kickers = draft_picks_draft
              .filter((draft_pick) => draft_pick?.metadata?.position === "K")
              .sort((a, b) => a.pick_no - b.pick_no);

            draft_picks_draft.forEach((draft_pick) => {
              const {
                draft_id,
                pick_no,
                player_id,
                roster_id,
                picked_by,
                metadata,
              } = draft_pick;

              const leagueLeagueId = draft_active.league_id;

              const league_type = draft_active.league_type;

              let rookie_pick;

              if (metadata?.position === "K") {
                rookie_pick =
                  "R" +
                  (kickers.findIndex((obj) => obj.player_id === player_id) + 1);
              }

              draft_picks_all.push({
                draftDraftId: draft_id,
                pick_no,
                player_id: rookie_pick || player_id,
                roster_id,
                picked_by,
                league_type,
                leagueLeagueId,
              });
            });
          }
        } catch (err) {
          console.log(err.message);
        }
      })
    );
  }

  return draft_picks_all;
};

const getAuctionPicks = async (auctions_complete) => {
  const auction_picks_all = [];

  const batchSize = 5;

  for (let i = 0; i < auctions_complete.length; i += batchSize) {
    await Promise.all(
      auctions_complete
        .slice(i, i + batchSize)
        .map(async (auction_complete) => {
          try {
            const auction_picks_auction = await fetchDraftPicks(
              auction_complete.draft_id
            );

            if (
              auction_picks_auction.find(
                (pick) => pick.metadata?.years_exp === "0"
              ) &&
              !auction_picks_auction.find(
                (pick) => pick.metadata?.position === "K"
              )
            ) {
              const rookies = auction_picks_auction
                .filter((pick) => pick?.metadata?.years_exp === "0")
                .sort(
                  (a, b) =>
                    parseInt(b.metadata.amount || 0) -
                    parseInt(a.metadata.amount || 0)
                );

              auction_picks_auction.forEach((auction_pick) => {
                const { draft_id, player_id, roster_id, picked_by, metadata } =
                  auction_pick;

                const leagueLeagueId = auction_complete.league_id;

                const league_type = auction_complete.league_type;

                let rookie_pick;

                if (metadata?.years_exp === "0") {
                  rookie_pick =
                    "R" +
                    (rookies.findIndex((obj) => obj.player_id === player_id) +
                      1);
                }

                const budget_percent = Math.round(
                  (parseInt(metadata?.amount || 0) /
                    auction_complete.settings.budget) *
                    100
                );

                if (parseInt(budget_percent)) {
                  auction_picks_all.push({
                    draftDraftId: draft_id,
                    budget_percent,
                    player_id,
                    roster_id,
                    picked_by,
                    league_type,
                    leagueLeagueId,
                  });

                  if (rookie_pick?.startsWith("R")) {
                    auction_picks_all.push({
                      draftDraftId: draft_id,
                      budget_percent,
                      player_id: rookie_pick,
                      roster_id,
                      picked_by,
                      league_type,
                      leagueLeagueId,
                    });
                  }
                }
              });
            }
          } catch (err) {
            console.log(err.message);
          }
        })
    );
  }

  return auction_picks_all.filter((x) => x);
};

exports.sync = async (app) => {
  const cutoff_default = new Date(new Date().getFullYear(), 0, 1).getTime();

  app.set("syncing", true);

  console.log("Beginning Draft Pick Sync...");

  const increment = 500;

  let counter_drafts = app.get("drafts_sync_counter")?.counter || 0;

  let cutoff_drafts = app.get("drafts_sync_counter")?.cutoff || cutoff_default;

  let counter_auctions = app.get("auctions_sync_counter")?.counter || 0;

  let cutoff_auctions =
    app.get("auctions_sync_counter")?.cutoff || cutoff_default;

  const drafts_data = await getActiveDrafts({
    increment,
    counter: counter_drafts,
    cutoff: cutoff_drafts,
  });

  const draft_picks = await getDraftPicks(drafts_data.drafts_active);

  const auctions_data = await getCompletedAuctions({
    increment,
    counter: counter_auctions,
    cutoff: cutoff_auctions,
  });

  const auction_picks = await getAuctionPicks(auctions_data.auctions_complete);

  await Draftpick.bulkCreate(draft_picks, {
    updateOnDuplicate: ["player_id", "roster_id", "picked_by"],
  });

  await Auctionpick.bulkCreate(auction_picks, {
    ignoreDuplicates: true,
  });

  console.log({ counter_drafts });

  console.log({ drafts_length: drafts_data.leagues_dbLength });

  console.log({ counter_auctions });

  console.log({ auctions_length: auctions_data.auctions_complete_length });

  if (drafts_data.leagues_dbLength < increment) {
    app.set("drafts_sync_counter", {
      counter: 0,
      cutoff: new Date().getTime(),
    });
  } else {
    app.set("drafts_sync_counter", {
      counter: counter_drafts + increment,
      cutoff: cutoff_drafts,
    });
  }

  if (auctions_data.auctions_complete_length < increment) {
    app.set("auctions_sync_counter", {
      counter: 0,
      cutoff: new Date().getTime(),
    });
  } else {
    app.set("auctions_sync_counter", {
      counter: counter_auctions + increment,
      cutoff: cutoff_auctions,
    });
  }

  app.set("syncing", false);

  console.log("Draft Pick Sync Complete...");
};
