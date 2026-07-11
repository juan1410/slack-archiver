import { WebClient, ErrorCode } from '@slack/web-api';
import { logger } from '../logger';
import { SlackMessage } from '../types';

export interface HistoryPage {
  messages: SlackMessage[];
  hasMore: boolean;
  nextCursor?: string;
}

export class SlackArchiveClient {
  private client: WebClient;

  constructor(botToken: string) {
    this.client = new WebClient(botToken, {
      retryConfig: { retries: 0 },
    });
  }

  async fetchHistoryPage(params: {
    channelId: string;
    oldestTs?: string;
    cursor?: string;
    limit?: number;
  }): Promise<HistoryPage> {
    try {
      const resp = await this.client.conversations.history({
        channel: params.channelId,
        oldest: params.oldestTs,
        cursor: params.cursor,
        limit: params.limit ?? 200,
        inclusive: false,
      });

      const messages = (resp.messages ?? []) as SlackMessage[];
      const hasMore = Boolean(resp.has_more);
      const nextCursor = resp.response_metadata?.next_cursor || undefined;

      return { messages, hasMore, nextCursor: hasMore ? nextCursor : undefined };
    } catch (err) {
      throw this.classifyError(err);
    }
  }

  async joinChannel(channelId: string): Promise<void> {
    try {
      await this.client.conversations.join({ channel: channelId });
    } catch (err) {
      // const slackErr = err as { data?: { error?: string } };
      // if (slackErr?.data?.error !== 'already_in_channel') {
      //   throw this.classifyError(err);
      // }
      throw this.classifyError(err);
    }
  }

  async listChannels(): Promise<Array<{ id: string; name: string }>> {
    try {
      const out: Array<{ id: string; name: string }> = [];
      let cursor: string | undefined;
      do {
        const resp = await this.client.conversations.list({
          cursor,
          limit: 200,
          types: 'public_channel,private_channel',
        });
        for (const c of resp.channels ?? []) {
          if (c.id && c.name) out.push({ id: c.id, name: c.name });
        }
        cursor = resp.response_metadata?.next_cursor || undefined;
      } while (cursor);
      return out;
    } catch(err) {
      throw this.classifyError(err);
    }
  }

  async getUserInfo(userId: string) {
    try {
      const resp = await this.client.users.info({ user: userId });
      return resp.user;
    } catch(err) {
      throw this.classifyError(err);
    }
  }

  private classifyError(err: unknown): SlackApiError {
    const e = err as { code?: string; retryAfter?: number; data?: { error?: string } };
    if (e?.code === ErrorCode.RateLimitedError) {
      return new SlackApiError('rate_limited', e.retryAfter ?? 30);
    }
    const slackErrorCode = e?.data?.error;
    logger.error({ err }, 'Slack API error');
    return new SlackApiError(slackErrorCode || 'unknown_error');
  }
}

export class SlackApiError extends Error {
  constructor(public slackCode: string, public retryAfterSeconds?: number) {
    super(`Slack API error: ${slackCode}`);
  }
}