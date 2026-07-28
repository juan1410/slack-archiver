import { Router, Request, Response } from 'express';
import { query } from '../db/pool';
import { requireTeamOwner } from '../middleware/requireTeamOwner';
import { MessageRow, ChannelRow } from '../types';

const router = Router();

router.get('/channels/:slackChannelId/messages', requireTeamOwner, async (req: Request, res: Response) => {
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

router.get('/channels/:slackChannelId/search', requireTeamOwner, async (req: Request, res: Response) => {
    const { teamId } = req.archiverUser!;
    const { slackChannelId } = req.params;
    const { q, from, to } = req.query as Record<string, string | undefined>;

    if (!q && !from && !to) {
      res.status(400).json({ error: 'Provide at least one filter: q, from, or to' });
      return;
    }
    if (q && q.trim().length < 2) {
      res.status(400).json({ error: 'Search query must be at least 2 characters' });
      return;
    }

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

    if (q) {
      params.push(`%${q.trim()}%`);
      conditions.push(`text ILIKE $${params.length}`);
    }
    if (from) {
      // Convert date string (YYYY-MM-DD) to a Slack timestamp
      const fromTs = (new Date(from).getTime() / 1000).toString();
      params.push(fromTs);
      conditions.push(`slack_ts >= $${params.length}`);
    }
    if (to) {
      // Add 1 day so "to" is inclusive of the whole end date
      const toDate = new Date(to);
      toDate.setDate(toDate.getDate() + 1);
      const toTs = (toDate.getTime() / 1000).toString();
      params.push(toTs);
      conditions.push(`slack_ts < $${params.length}`);
    }

    const result = await query<MessageRow>(
      `SELECT * FROM messages
       WHERE ${conditions.join(' AND ')}
       ORDER BY slack_ts DESC
       LIMIT 100`,
      params
    );

    res.json({
      channel: { id: channel.slack_channel_id, name: channel.channel_name },
      query: q || null,
      from: from || null,
      to: to || null,
      results: result.rows,
      count: result.rows.length,
    });
  }
);

export default router;