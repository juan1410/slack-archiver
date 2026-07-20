import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { query } from '../db/pool';
import { requireTeamOwner } from '../middleware/requireTeamOwner';
import { SlackArchiveClient } from '../slack/client';
import { ChannelRow, TeamRow } from '../types';

const router = Router();

const addChannelSchema = z.object({
  slackChannelId: z.string().min(1),
  channelName: z.string().min(1),
});

router.get('/', requireTeamOwner, async (req: Request, res: Response) => {
  const { teamId } = req.archiverUser!;
  const result = await query<ChannelRow>(
    'SELECT * FROM channels WHERE team_id = $1 ORDER BY created_at DESC',
    [teamId]
  );
  res.json({ channels: result.rows });
});

router.post('/', requireTeamOwner, async (req: Request, res: Response) => {
  const parsed = addChannelSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { slackChannelId, channelName } = parsed.data;
  const { teamId, slackUserId } = req.archiverUser!;

  const teamResult = await query<TeamRow>('SELECT * FROM teams WHERE id = $1', [teamId]);
  const team = teamResult.rows[0];

  try {
    const slack = new SlackArchiveClient(team.bot_access_token);
    await slack.joinChannel(slackChannelId);

    const upserted = await query<ChannelRow>(
      `INSERT INTO channels (team_id, slack_channel_id, channel_name, is_active, added_by_slack_user_id)
       VALUES ($1, $2, $3, true, $4)
       ON CONFLICT (team_id, slack_channel_id)
       DO UPDATE SET is_active = true, channel_name = $3, updated_at = now()
       RETURNING *`,
      [teamId, slackChannelId, channelName, slackUserId]
    );

    res.status(201).json({ channel: upserted.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add channel', detail: (err as Error).message });
  }
});

router.delete('/:slackChannelId', requireTeamOwner, async (req: Request, res: Response) => {
  const { teamId } = req.archiverUser!;
  const { slackChannelId } = req.params;

  const result = await query<ChannelRow>(
    `UPDATE channels SET is_active = false, updated_at = now()
     WHERE team_id = $1 AND slack_channel_id = $2
     RETURNING *`,
    [teamId, slackChannelId]
  );

  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Channel not found in archive list' });
    return;
  }
  res.json({ channel: result.rows[0] });
});

export default router;