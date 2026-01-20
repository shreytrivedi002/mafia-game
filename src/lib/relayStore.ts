import type { GameState, RelayEvent, RelayEventWithIndex, SecretMessage } from "@/lib/types";
import connectToDatabase from "./db";
import { GameModel } from "./models";

// Define CachedGame type to match our in-memory needs
type CachedGame = {
  state?: GameState;
  events: Array<RelayEvent & { index: number }>;
  eventIds: Set<string>;
  inbox: Map<string, { token: string; messages: SecretMessage[] }>;
  nextEventIndex: number;
};

// Global in-memory cache
const cache = new Map<string, CachedGame>();

// Helper to get game from Cache or DB
async function getGame(gameId: string): Promise<CachedGame | null> {
  // 1. Try Cache
  if (cache.has(gameId)) {
    return cache.get(gameId)!;
  }

  // 2. Try DB
  await connectToDatabase();
  const dbGame = await GameModel.findOne({ gameId }).lean();

  if (!dbGame) {
    return null;
  }

  // 3. Hydrate Cache
  const cached: CachedGame = {
    state: dbGame.state,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    events: (dbGame.events as any[]) || [],
    eventIds: new Set(dbGame.eventIds as string[]),
    inbox: new Map(),
    nextEventIndex: dbGame.nextEventIndex || 1,
  };

  // Hydrate inbox map from DB object/map
  if (dbGame.inbox) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inboxAny = dbGame.inbox as any;
    const keys = inboxAny instanceof Map ? inboxAny.keys() : Object.keys(inboxAny);
    for (const key of keys) {
      const val = inboxAny instanceof Map ? inboxAny.get(key) : inboxAny[key];
      // val might be { token, messages }
      // If messages are subdocs from Mongoose, they might need processing, but lean() helps.
      cached.inbox.set(key, val);
    }
  }

  cache.set(gameId, cached);
  return cached;
}

// Helper to persist changes to DB
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function persistGame(gameId: string, update: any) {
  await connectToDatabase();
  await GameModel.updateOne({ gameId }, update, { upsert: true });
}

export async function getState(gameId: string): Promise<GameState | undefined> {
  const game = await getGame(gameId);
  return game?.state;
}

export async function setState(gameId: string, nextState: GameState): Promise<GameState> {
  const game = await getGame(gameId);

  // Update Cache
  if (game) {
    game.state = nextState;
  } else {
    // Rare case: Set state on non-existent game (init)
    cache.set(gameId, {
      state: nextState,
      events: [],
      eventIds: new Set(),
      inbox: new Map(),
      nextEventIndex: 1,
    });
  }

  // Update DB
  await connectToDatabase();
  await GameModel.findOneAndUpdate(
    { gameId },
    { $set: { state: nextState } },
    { upsert: true, new: true }
  );

  return nextState;
}

export async function addEvent(gameId: string, event: RelayEvent): Promise<number | null> {
  let game = await getGame(gameId);

  // If game doesn't exist in cache/DB, initialize it (Cold Start)
  if (!game) {
    game = {
      events: [],
      eventIds: new Set(),
      inbox: new Map(),
      nextEventIndex: 1,
    };
    cache.set(gameId, game);

    // Also create in DB immediately
    await connectToDatabase();
    await new GameModel({
      gameId,
      events: [],
      eventIds: [],
      inbox: {},
      nextEventIndex: 1
    }).save();
  }

  if (game.eventIds.has(event.id)) {
    return null;
  }

  // Update Cache
  const index = game.nextEventIndex++;
  game.events.push({ ...event, index });
  game.eventIds.add(event.id);

  if (event.type === "JOIN") {
    const { playerId, token } = event.payload;
    if (!game.inbox.has(playerId)) {
      game.inbox.set(playerId, { token, messages: [] });
    }
  }

  // Update DB
  // We use $push for atomic updates where possible, avoiding race conditions on events array
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateQuery: any = {
    $push: { events: { ...event, index }, eventIds: event.id },
    $set: { nextEventIndex: game.nextEventIndex }
  };

  if (event.type === "JOIN") {
    const { playerId, token } = event.payload;
    updateQuery[`$set`][`inbox.${playerId}`] = { token, messages: [] };
  }

  await persistGame(gameId, updateQuery);
  return index;
}

export async function getEvents(gameId: string, afterIndex: number): Promise<RelayEventWithIndex[]> {
  const game = await getGame(gameId);
  if (!game) return [];
  return game.events.filter((event) => event.index > afterIndex);
}

export async function pushInboxMessage(
  gameId: string,
  playerId: string,
  message: SecretMessage,
): Promise<boolean> {
  const game = await getGame(gameId);
  if (!game) return false;

  const inbox = game.inbox.get(playerId);
  if (!inbox) return false;

  // Update Cache
  inbox.messages.push(message);

  // Update DB
  await persistGame(gameId, {
    $push: { [`inbox.${playerId}.messages`]: message }
  });

  return true;
}

export async function pullInboxMessages(
  gameId: string,
  playerId: string,
  token: string,
): Promise<SecretMessage[] | null> {
  const game = await getGame(gameId);
  if (!game) return null;

  const inbox = game.inbox.get(playerId);
  if (!inbox || inbox.token !== token) {
    return null;
  }

  // Update Cache
  const messages = [...inbox.messages];
  inbox.messages = [];

  // Update DB (Clear messages)
  await persistGame(gameId, {
    $set: { [`inbox.${playerId}.messages`]: [] }
  });

  return messages;
}
