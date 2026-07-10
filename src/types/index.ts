export interface TeamRow {
  id: number;
  slack_team_id: string;
  team_name: string;
  bot_user_id: string | null;
  bot_access_token: string;
  installed_by_slack_user_id: string;
  created_at: Date;
  updated_at: Date;
}

export interface ChannelRow {
  id: number;
  team_id: number;
  slack_channel_id: string;
  channel_name: string;
  is_active: boolean;
  added_by_slack_user_id: string;
  created_at: Date;
  updated_at: Date;
}

export interface MessageRow {
  id: number;
  channel_id: number;
  slack_ts: string;
  slack_user_id: string | null;
  thread_ts: string | null;
  message_type: string | null;
  subtype: string | null;
  text: string | null;
  raw: Record<string, unknown>;
  created_at: Date;
}

export type ArchiveRunStatus = 'running' | 'success' | 'error';

export interface ArchiveRunRow {
  id: number;
  channel_id: number;
  started_at: Date;
  finished_at: Date | null;
  status: ArchiveRunStatus;
  messages_fetched: number;
  last_ts: string | null;
  error_message: string | null;
}

export interface SlackMessage {
  type: string;
  subtype?: string;
  user?: string;
  text?: string;
  ts: string;
  thread_ts?: string;
  [key: string]: unknown;
}

export interface AuthedRequestUser {
  slackUserId: string;
  teamId: number;
  slackTeamId: string;
  isOwner: boolean;
}
