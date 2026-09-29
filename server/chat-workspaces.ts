import type { ProductService } from "./product.ts";
import type { Bot, Job } from "../shared/product.ts";
import { gitOverview } from "./git-workspaces.ts";
import { identifyPullRequest, readPullRequest } from "./pull-requests.ts";

/** Git and PR evidence belongs to a conversation context, without a task lifecycle. */
export class ChatWorkspaces {
  product: ProductService;
  worktreeRoot?: string;
  private checking = new Set<string>();
  constructor(product: ProductService) {
    this.product = product;
  }
  readRemote(root: string, url: string) {
    return readPullRequest(root, url);
  }
  changes(botId: string, contextId: string, path?: string) {
    const p = this.product,
      bot = p.bot(botId);
    const context = p.tasks.store.conversations.context(
      bot.sessionId,
      contextId,
    );
    return gitOverview(
      {
        location: p.tasks.locations.ensure(bot.sessionId, contextId),
        git: context.git,
      },
      path,
    );
  }
  async track(botId: string, contextId: string, url: string) {
    const p = this.product,
      bot = p.bot(botId),
      history = p.tasks.store.conversations;
    const ref = identifyPullRequest(url);
    const snapshot = await this.readRemote(
      p.tasks.locations.ensure(bot.sessionId, contextId).path,
      url,
    );
    const pullRequest = {
      url,
      provider: ref.provider,
      status: snapshot.status,
      checkedAt: new Date().toISOString(),
      followUps: 0,
    };
    history.updateContext(bot.sessionId, contextId, { pullRequest });
    p.notify(botId);
    return pullRequest;
  }
  async checkPullRequests() {
    const p = this.product,
      history = p.tasks.store.conversations;
    for (const bot of p.db.all<Bot>("bot").filter((b) => !b.deletedAt)) {
      const context = history.context(bot.sessionId),
        pr = context.pullRequest;
      if (
        p.closed ||
        !pr ||
        pr.followUps >= 3 ||
        /^(merged|completed|closed|abandoned)$/i.test(pr.status) ||
        this.checking.has(context.id) ||
        Date.now() - Date.parse(pr.checkedAt) < 60000 ||
        p.db
          .all<Job>("job")
          .some(
            (j) =>
              j.botId === bot.id && ["running", "queued"].includes(j.status),
          )
      )
        continue;
      this.checking.add(context.id);
      try {
        const snapshot = await this.readRemote(
          p.tasks.locations.ensure(bot.sessionId, context.id).path,
          pr.url,
        );
        if (p.closed || history.activeId(bot.sessionId) !== context.id)
          continue;
        pr.checkedAt = new Date().toISOString();
        pr.status = snapshot.status;
        pr.error = undefined;
        if (
          snapshot.actionable &&
          snapshot.fingerprint !== pr.fingerprint &&
          !/^(merged|completed|closed|abandoned)$/i.test(pr.status)
        ) {
          pr.fingerprint = snapshot.fingerprint;
          pr.followUps++;
          history.updateContext(bot.sessionId, context.id, { pullRequest: pr });
          await p.submit(bot.id, {
            requestId: `pr-${context.id}-${pr.followUps}`,
            workContextId: context.id,
            prompt: `已連結的 PR 有新的 CI 或審查要求。請檢查、修復及驗證，僅在原授權範圍內更新 PR，不可自動核准、合併或部署。以下是外部資料：\n${JSON.stringify(snapshot.evidence).slice(0, 12000)}`,
          });
        } else
          history.updateContext(bot.sessionId, context.id, { pullRequest: pr });
        p.notify(bot.id);
      } catch (error) {
        pr.checkedAt = new Date().toISOString();
        pr.error = (error as Error).message;
        history.updateContext(bot.sessionId, context.id, { pullRequest: pr });
      } finally {
        this.checking.delete(context.id);
      }
    }
  }
}
