import { Request, Response, NextFunction } from 'express';
import { query } from '../db/pool';
import { SlackArchiveClient } from '../slack/client';
import { logger } from '../logger';
import { TeamRow, AuthedRequestUser } from '../types';

declare global {
  namespace Express {
    interface Request {
      archiverUser?: AuthedRequestUser;
    }
  }
}

export async function requireTeamOwner(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const slackUserId = req.header('x-slack-user-id');
  const slackTeamId = req.header('x-slack-team-id');

  if (!slackUserId || !slackTeamId) {
    res.status(401).json({ error: 'Missing x-slack-user-id or x-slack-team-id header' });
    return;
  }

  try {
    const teamResult = await query<TeamRow>(
      'SELECT * FROM teams WHERE slack_team_id = $1',
      [slackTeamId]
    );
    const team = teamResult.rows[0];
    if (!team) {
      res.status(404).json({ error: 'Team not found / app not installed for this team' });
      return;
    }

    const slack = new SlackArchiveClient(team.bot_access_token);
    const user = await slack.getUserInfo(slackUserId);

    const isOwner = Boolean(user?.is_owner || user?.is_primary_owner);
    if (!isOwner) {
      res.status(403).json({ error: 'Only Slack Team owners can manage the archiver' });
      return;
    }

    req.archiverUser = {
      slackUserId,
      teamId: team.id,
      slackTeamId,
      isOwner: true,
    };
    next();
  } catch (err) {
    logger.error({ err }, 'Owner check failed');
    res.status(500).json({ error: 'Failed to verify Slack permissions' });
  }
}