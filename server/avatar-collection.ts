import { randomInt } from "node:crypto";
import {
  botAvatars,
  avatarDrawCost,
  isBotAvatar,
  type AvatarAchievement,
  type AvatarCollection,
  type AvatarDraw,
  type AvatarDrawResponse,
  type BotAvatarId,
} from "../shared/bot-avatars.ts";
import type { Artifact, Job } from "../shared/product.ts";
import type { ProductDB } from "./product-db.ts";

interface CollectionRecord {
  id: "global";
  startedAt: string;
  revision: number;
  balance: number;
  acquired: Partial<Record<BotAvatarId, string>>;
  achievements: Partial<Record<AvatarAchievement, string>>;
  lastDraw?: AvatarDraw;
}
const reject = (message: string, status = 400): never => {
  throw Object.assign(new Error(message), { status });
};

export class AvatarCollectionService {
  private db: ProductDB;
  constructor(db: ProductDB) {
    this.db = db;
  }

  init() {
    this.db.transaction(() => {
      if (!this.db.get("avatar-collection", "global"))
        this.db.put<CollectionRecord>("avatar-collection", {
          id: "global",
          startedAt: new Date().toISOString(),
          revision: 0,
          balance: 0,
          acquired: {},
          achievements: {},
        });
    });
  }
  private read() {
    return this.db.get<CollectionRecord>("avatar-collection", "global")!;
  }
  view(): AvatarCollection {
    const state = this.read();
    const owned = botAvatars
      .filter((a) => a.series === "basic" || state.acquired[a.id])
      .map((a) => ({ avatarId: a.id, acquiredAt: state.acquired[a.id] }));
    return {
      startedAt: state.startedAt,
      revision: state.revision,
      balance: state.balance,
      drawCost: avatarDrawCost,
      owned,
      achievements: state.achievements,
      remaining: botAvatars.length - owned.length,
      lastDraw: state.lastDraw,
    };
  }
  requireOwned(value: unknown): BotAvatarId {
    if (!isBotAvatar(value)) return reject("請選擇有效的 Bot 圖示。");
    const avatar = botAvatars.find((a) => a.id === value)!;
    if (avatar.series !== "basic" && !this.read().acquired[value])
      return reject("尚未擁有這款頭像，請先抽取獲得。", 403);
    return value;
  }
  /** Persist the terminal job and its reward together, including zero-point receipts. */
  finish(job: Job) {
    this.db.transaction(() => {
      this.db.put("job", job);
      const state = this.read();
      if (
        job.status !== "completed" ||
        !job.avatarRewardsEligible ||
        job.createdAt < state.startedAt ||
        this.db.get("avatar-reward", job.id)
      )
        return;
      const at = new Date().toISOString();
      const delegated =
        !!job.delegatedBy ||
        !!job.parentJobId ||
        job.contextKind === "delegation";
      let points = delegated ? 0 : 10;
      const earned: AvatarAchievement[] = [];
      const award = (key: AvatarAchievement, qualifies: boolean) => {
        if (qualifies && !state.achievements[key]) {
          state.achievements[key] = at;
          earned.push(key);
          points += 20;
        }
      };
      award("collaboration", delegated);
      award("routine", job.contextKind === "routine");
      award(
        "delivery",
        !state.achievements.delivery &&
          !!job.runId &&
          this.db
            .all<Artifact>("artifact")
            .some(
              (a) =>
                a.kind === "result" &&
                a.runId === job.runId &&
                a.botId === job.botId,
            ),
      );
      state.balance += points;
      state.revision++;
      this.db.put("avatar-reward", {
        id: job.id,
        points,
        achievements: earned,
        createdAt: at,
      });
      this.db.put("avatar-collection", state);
    });
  }
  draw(requestId: unknown): AvatarDrawResponse {
    if (
      typeof requestId !== "string" ||
      !/^[a-zA-Z0-9_-]{16,100}$/.test(requestId)
    )
      return reject("抽取請求識別碼無效。");
    return this.db.transaction(() => {
      const previous = this.db.get<AvatarDraw>("avatar-draw", requestId);
      if (previous) return { draw: previous, avatarCollection: this.view() };
      const state = this.read();
      const pool = botAvatars.filter(
        (a) => a.series !== "basic" && !state.acquired[a.id],
      );
      if (!pool.length) return reject("已全部收藏。", 409);
      if (state.balance < avatarDrawCost)
        return reject("點數不足，無法抽取頭像。", 409);
      const avatar = pool[randomInt(pool.length)]!;
      const createdAt = new Date().toISOString();
      state.balance -= avatarDrawCost;
      state.revision++;
      state.acquired[avatar.id] = createdAt;
      const draw: AvatarDraw = {
        id: requestId,
        avatarId: avatar.id,
        createdAt,
        balanceAfter: state.balance,
      };
      state.lastDraw = draw;
      this.db.put("avatar-draw", draw);
      this.db.put("avatar-collection", state);
      return { draw, avatarCollection: this.view() };
    });
  }
}
