import { query, withTransaction } from '../db/pool';
import { SlackArchiveClient, SlackApiError } from '../slack/client';
import { logger } from '../logger';
import { ChannelRow, TeamRow, SlackMessage } from '../types';

const MAX_PAGES_PER_CYCLE = Number(process.env.ARCHIVE_MAX_PAGES_PER_CYCLE ?? 20);

export async function archiveChannel(
  team: TeamRow,
  channel: ChannelRow
): Promise<{ messagesFetched: number; status: 'success' | 'error'; errorMessage?: string }> {
  const slack = new SlackArchiveClient(team.bot_access_token);

  const cursorResult = await query<{ last_ts: string | null }>(
    `SELECT last_ts FROM archive_runs
     WHERE channel_id = $1 AND status = 'success' AND last_ts IS NOT NULL
     ORDER BY started_at DESC LIMIT 1`,
    [channel.id]
  );
  const resumeCursor = cursorResult.rows[0]?.last_ts ?? undefined;

  const runInsert = await query<{ id: number }>(
    `INSERT INTO archive_runs (channel_id, status) VALUES ($1, 'running') RETURNING id`,
    [channel.id]
  );
  const runId = runInsert.rows[0].id;

  let totalFetched = 0;
  let newestTsThisRun: string | undefined;
  let slackCursor: string | undefined;
  let page = 0;

  try {
    do {
      const result = await slack.fetchHistoryPage({
        channelId: channel.slack_channel_id,
        oldestTs: resumeCursor,
        cursor: slackCursor,
      });

      if (result.messages.length > 0) {
        await persistMessages(channel.id, result.messages);
        totalFetched += result.messages.length;

        if (!newestTsThisRun) {
          newestTsThisRun = result.messages[0].ts;
        }
      }

      slackCursor = result.nextCursor;
      page += 1;

      if (page >= MAX_PAGES_PER_CYCLE) {
        logger.warn(
          { channelId: channel.id, page },
          'Hit max-pages-per-cycle safety valve; remaining messages will be picked up next cycle'
        );
        break;
      }
    } while (slackCursor);

    await query(
      `UPDATE archive_runs
       SET status = 'success', finished_at = now(), messages_fetched = $1, last_ts = COALESCE($2, last_ts)
       WHERE id = $3`,
      [totalFetched, newestTsThisRun ?? resumeCursor ?? null, runId]
    );

    logger.info(
      { channelId: channel.id, channelName: channel.channel_name, totalFetched },
      'Archive run completed'
    );
    return { messagesFetched: totalFetched, status: 'success' };
  } catch (err) {
    const isRateLimit = err instanceof SlackApiError && err.slackCode === 'rate_limited';
    const errorMessage = (err as Error).message;

    await query(
      `UPDATE archive_runs
       SET status = 'error', finished_at = now(), messages_fetched = $1, error_message = $2
       WHERE id = $3`,
      [totalFetched, errorMessage, runId]
    );

    if (isRateLimit) {
      const retryAfter = (err as SlackApiError).retryAfterSeconds ?? 30;
      logger.warn(
        { channelId: channel.id, retryAfter },
        'Rate limited by Slack; will retry next poll cycle'
      );
    } else {
      logger.error({ err, channelId: channel.id }, 'Archive run failed');
    }

    return { messagesFetched: totalFetched, status: 'error', errorMessage };
  }
}

async function persistMessages(channelId: number, messages: SlackMessage[]): Promise<void> {
  await withTransaction(async (client) => {
    for (const msg of messages) {
      await client.query(
        `INSERT INTO messages (channel_id, slack_ts, slack_user_id, thread_ts, message_type, subtype, text, raw)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (channel_id, slack_ts) DO NOTHING`,
        [
          channelId,
          msg.ts,
          msg.user ?? null,
          msg.thread_ts ?? null,
          msg.type ?? null,
          msg.subtype ?? null,
          msg.text ?? null,
          JSON.stringify(msg),
        ]
      );
    }
  });
}