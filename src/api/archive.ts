import { Router, Request, Response } from 'express';
import { query } from '../db/pool';
import { requireTeamOwner } from '../middleware/requireTeamOwner';
import { MessageRow, ChannelRow } from '../types';

const router = Router();

router.get(
  '/channels/:slackChannelId/messages',
  requireTeamOwner,
  async (req: Request, res: Response) => {
    const { teamId } = req.archiverUser!;
    const { slackChannelId } = req.params;
    const { since, until, user, cursor } = req.query as Record<string, string | undefined>;
    const limit = Math.min(Number(req.query.limit ?? 100), 500);

    const channelResult = await query<ChannelRow>(
      'SELECT * FROM channels WHERE team_id = $1 AND slack_channel_id = $2',
      [teamId, slackChannelId]
    );
    const channel = channelResult.rows[0];
    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    const conditions: string[] = ['channel_id = $1'];
    const params: unknown[] = [channel.id];

    if (since) {
      params.push(since);
      conditions.push(`slack_ts >= $${params.length}`);
    }
    if (until) {
      params.push(until);
      conditions.push(`slack_ts <= $${params.length}`);
    }
    if (user) {
      params.push(user);
      conditions.push(`slack_user_id = $${params.length}`);
    }
    if (cursor) {
      params.push(cursor);
      conditions.push(`slack_ts > $${params.length}`);
    }

    params.push(limit);
    const sql = `
      SELECT * FROM messages
      WHERE ${conditions.join(' AND ')}
      ORDER BY slack_ts ASC
      LIMIT $${params.length}
    `;

    const result = await query<MessageRow>(sql, params);
    const nextCursor = result.rows.length === limit ? result.rows[result.rows.length - 1].slack_ts : null;

    res.json({
      channel: { id: channel.slack_channel_id, name: channel.channel_name },
      messages: result.rows,
      pagination: { nextCursor, limit },
    });
  }
);

export default router;