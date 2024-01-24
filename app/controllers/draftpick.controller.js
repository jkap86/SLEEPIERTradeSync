"use strict";

const { fetchDraftPicks } = require("../api/sleeperApi");
const db = require("../models");
const Op = db.Sequelize.Op;
const Draftpick = db.draftpicks;
const Draft = db.drafts;
const League = db.leagues;

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
            [Op.and]: [
              {
                slots_k: 1,
              },
              {
                [Op.not]: { slots_dl: { [Op.ne]: null } },
              },
              {
                [Op.not]: { slots_lb: { [Op.ne]: null } },
              },
              {
                [Op.not]: { slots_db: { [Op.ne]: null } },
              },
              {
                [Op.not]: { slots_idp_flex: { [Op.ne]: null } },
              },
              {
                [Op.not]: { slots_def: { [Op.ne]: null } },
              },
            ],
          },
        },
      ],
    },
    include: {
      model: League,
      where: {
        roster_positions: {
          [Op.not]: {
            [Op.contains]: ["K"],
          },
        },
      },
    },
    raw: true,
  });

  console.log({ drafts_active_keys: Object.keys(drafts_active) });

  return { drafts_active, leagues_dbLength: drafts_active.length };
};

const getDraftPicks = async (drafts_active) => {
  const draft_picks_all = [];

  const batchSize = 5;

  for (let i = 0; i < drafts_active.length; i += batchSize) {
    await Promise.all(
      drafts_active.slice(i, i + batchSize).map(async (draft_active) => {
        const draft_picks_draft = await fetchDraftPicks(draft_active.draft_id);

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
      })
    );
  }

  return draft_picks_all;
};

exports.sync = async (app) => {
  const cutoff_default = new Date(new Date().getFullYear(), 0, 1).getTime();

  app.set("syncing", true);

  console.log("Beginning Draft Pick Sync...");

  const increment = 500;

  let counter = app.get("drafts_sync_counter")?.counter || 0;

  let cutoff = app.get("drafts_sync_counter")?.cutoff || cutoff_default;

  const drafts_data = await getActiveDrafts({ increment, counter, cutoff });

  const draft_picks = await getDraftPicks(drafts_data.drafts_active);

  await Draftpick.bulkCreate(draft_picks, {
    updateOnDuplicate: ["player_id", "roster_id", "picked_by"],
  });

  console.log({ counter });

  console.log({ leagues_dbLength: drafts_data.leagues_dbLength });

  if (drafts_data.leagues_dbLength < increment) {
    app.set("drafts_sync_counter", {
      counter: 0,
      cutoff: new Date().getTime(),
    });
  } else {
    app.set("drafts_sync_counter", {
      counter: counter + increment,
      cutoff: cutoff,
    });
  }

  app.set("syncing", false);

  console.log("Draft Pick Sync Complete...");
};
