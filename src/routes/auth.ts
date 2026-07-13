import { Router, Request, Response } from 'express';
import axios from 'axios';
import { query } from '../db/pool';
import { logger } from '../logger';
import { TeamRow } from '../types';

const router = Router();

const SLACK_SCOPES = [
  'channels:history',
  'channels:read',
  'channels:join',
  'groups:history',
  'groups:read',
  'users:read',
].join(',');

router.get('/slack/install', (_req: Request, res: Response) => {
  const params = new URLSearchParams({
    client_id: process.env.SLACK_CLIENT_ID || '',
    scope: SLACK_SCOPES,
    redirect_uri: process.env.SLACK_REDIRECT_URI || '',
  });
  res.redirect(`https://slack.com/oauth/v2/authorize?${params.toString()}`);
});

router.get('/slack/callback', async (req: Request, res: Response) => {
  const { code, error } = req.query;

  if (error) {
    return res.status(400).send(`Slack OAuth error: ${error}`);
  }
  if (!code || typeof code !== 'string') {
    return res.status(400).send('Missing OAuth code');
  }

  try {
    const tokenResp = await axios.post(
      'https://slack.com/api/oauth.v2.access',
      new URLSearchParams({
        client_id: process.env.SLACK_CLIENT_ID || '',
        client_secret: process.env.SLACK_CLIENT_SECRET || '',
        code,
        redirect_uri: process.env.SLACK_REDIRECT_URI || '',
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const data = tokenResp.data;
    if (!data.ok) {
      logger.error({ data }, 'Slack OAuth token exchange failed');
      return res.status(400).send(`Slack OAuth failed: ${data.error}`);
    }

    const slackTeamId: string = data.team.id;
    const teamName: string = data.team.name;
    const botToken: string = data.access_token;
    const botUserId: string = data.bot_user_id;
    const installerUserId: string = data.authed_user?.id;

    const upserted = await query<TeamRow>(
      `INSERT INTO teams (slack_team_id, team_name, bot_user_id, bot_access_token, installed_by_slack_user_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (slack_team_id)
       DO UPDATE SET team_name = $2, bot_user_id = $3, bot_access_token = $4, updated_at = now()
       RETURNING *`,
      [slackTeamId, teamName, botUserId, botToken, installerUserId]
    );

    const team = upserted.rows[0];
    logger.info({ teamId: team.id, slackTeamId }, 'Slack app installed for team');

    res.send(`Slack Archiver installed for "${teamName}". You can close this tab.`);
  } catch (err) {
    logger.error({ err }, 'OAuth callback failed');
    res.status(500).send('Internal error during Slack OAuth callback');
  }
});

export default router;