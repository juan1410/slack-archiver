import 'dotenv/config';
import { query } from '../db/pool';
import { logger } from '../logger';
import { archiveChannel } from './archiveChannel';
import { ChannelRow, TeamRow } from '../types';

const POLL_INTERVAL_MS = Number(process.env.ARCHIVE_POLL_INTERVAL_MS ?? 5 * 60 * 1000);

interface ChannelWithTeamRow extends ChannelRow {
  team_pk: number;
  team_slack_team_id: string;
  team_name: string;
  team_bot_user_id: string | null;
  team_bot_access_token: string;
  team_installed_by_slack_user_id: string;
  team_created_at: Date;
  team_updated_at: Date;
}

async function pollOnce(): Promise<void> {
  const activeChannels = await query<ChannelWithTeamRow>(
    `SELECT c.*,
            t.id as team_pk,
            t.slack_team_id as team_slack_team_id,
            t.team_name as team_name,
            t.bot_user_id as team_bot_user_id,
            t.bot_access_token as team_bot_access_token,
            t.installed_by_slack_user_id as team_installed_by_slack_user_id,
            t.created_at as team_created_at,
            t.updated_at as team_updated_at
     FROM channels c
     JOIN teams t ON t.id = c.team_id
     WHERE c.is_active = true`
  );

  
  if (activeChannels.rows.length === 0) {
    logger.info('No active channels to archive this cycle');
    return;
  }

  logger.info({ count: activeChannels.rows.length }, 'Starting archive poll cycle');

  for (const row of activeChannels.rows) {
    const team: TeamRow = {
      id: row.team_pk,
      slack_team_id: row.team_slack_team_id,
      team_name: row.team_name,
      bot_user_id: row.team_bot_user_id,
      bot_access_token: row.team_bot_access_token,
      installed_by_slack_user_id: row.team_installed_by_slack_user_id,
      created_at: row.team_created_at,
      updated_at: row.team_updated_at,
    };
    const channel: ChannelRow = {
      id: row.id,
      team_id: row.team_id,
      slack_channel_id: row.slack_channel_id,
      channel_name: row.channel_name,
      is_active: row.is_active,
      added_by_slack_user_id: row.added_by_slack_user_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };

    try {
      await archiveChannel(team, channel);
    } catch (err) {
      logger.error({ err, channelId: channel.id }, 'Unhandled error archiving channel');
    }
  }

  logger.info('Archive poll cycle complete');
}

async function main(): Promise<void> {
  logger.info({ intervalMs: POLL_INTERVAL_MS }, 'Slack Archiver worker starting');

  await pollOnce();
  setInterval(() => {
    pollOnce().catch((err) => logger.error({ err }, 'Poll cycle crashed'));
  }, POLL_INTERVAL_MS);
}

main().catch((err) => {
  logger.error({ err }, 'Worker failed to start');
  process.exit(1);
});