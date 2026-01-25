import type { GameState, RelayEvent, RelayEventWithIndex, SecretMessage } from "@/lib/types";
import clientPromise from "./mongodb";

const DB_NAME = "mafia";
const COLLECTIONS = {
  games: "games",
  events: "events",
  inbox: "inbox",
} as const;

type RelayGameDoc = {
  _id: string; // gameId
  gameId?: string; // Some deployments have a unique index on this field
  state?: GameState;
  nextEventIndex: number;
  updatedAt: number;
};

type RelayEventDoc = {
  _id: string; // `${gameId}:${eventId}`
  gameId: string;
  eventId: string;
  event: RelayEvent;
  index: number;
  createdAt: number;
};

type InboxDoc = {
  _id: string; // `${gameId}:${playerId}`
  gameId: string;
  playerId: string;
  token: string;
  messages: SecretMessage[];
  updatedAt: number;
};

async function ensureInboxFromJoinEvent(
  gameId: string,
  playerId: string,
): Promise<{ token: string } | null> {
  const client = await clientPromise;
  const db = client.db(DB_NAME);

  const join = await db
    .collection<RelayEventDoc>(COLLECTIONS.events)
    .find({
      gameId,
      "event.type": "JOIN",
      "event.payload.playerId": playerId,
    })
    .sort({ createdAt: -1 })
    .limit(1)
    .toArray();

  const latest = join[0]?.event;
  if (!latest || latest.type !== "JOIN") {
    return null;
  }

  const token = latest.payload.token;
  await db.collection<InboxDoc>(COLLECTIONS.inbox).updateOne(
    { _id: `${gameId}:${playerId}` },
    {
      $set: {
        gameId,
        playerId,
        token,
        updatedAt: Date.now(),
      },
      $setOnInsert: {
        messages: [],
      },
    },
    { upsert: true },
  );

  return { token };
}

export async function getState(gameId: string): Promise<GameState | undefined> {
  const client = await clientPromise;
  const db = client.db(DB_NAME);
  const doc = await db.collection<RelayGameDoc>(COLLECTIONS.games).findOne({ _id: gameId });
  return doc?.state;
}

export async function setState(gameId: string, nextState: GameState): Promise<GameState> {
  const client = await clientPromise;
  const db = client.db(DB_NAME);
  await db.collection<RelayGameDoc>(COLLECTIONS.games).updateOne(
    { _id: gameId },
    {
      $set: {
        gameId,
        state: nextState,
        updatedAt: Date.now(),
      },
      $setOnInsert: {
        nextEventIndex: 1,
      },
    },
    { upsert: true },
  );
  return nextState;
}

export async function addEvent(gameId: string, event: RelayEvent): Promise<number | null> {
  const client = await clientPromise;
  const db = client.db(DB_NAME);

  const eventKey = `${gameId}:${event.id}`;

  // Ensure JOIN always registers inbox, even if the event is duplicated/retried.
  if (event.type === "JOIN") {
    const { playerId, token } = event.payload;
    await db.collection<InboxDoc>(COLLECTIONS.inbox).updateOne(
      { _id: `${gameId}:${playerId}` },
      {
        $set: {
          gameId,
          playerId,
          token,
          updatedAt: Date.now(),
        },
        $setOnInsert: {
          messages: [],
        },
      },
      { upsert: true },
    );
  }

  // Atomically allocate the next event index (use pre-increment value).
  // If the game doc doesn't exist yet, index starts at 1.
  const before = await db.collection<RelayGameDoc>(COLLECTIONS.games).findOneAndUpdate(
    { _id: gameId },
    {
      $inc: { nextEventIndex: 1 },
      $set: { updatedAt: Date.now(), gameId },
      $setOnInsert: { nextEventIndex: 1, gameId },
    },
    { upsert: true, returnDocument: "before" },
  );
  const index = before?.nextEventIndex ?? 1;

  try {
    await db.collection<RelayEventDoc>(COLLECTIONS.events).insertOne({
      _id: eventKey,
      gameId,
      eventId: event.id,
      event,
      index,
      createdAt: Date.now(),
    });
  } catch (error: any) {
    // Duplicate key means we've already processed this event (idempotency).
    if (typeof error?.message === "string" && error.message.includes("E11000")) {
      return null;
    }
    throw error;
  }

  return index;
}

export async function getEvents(
  gameId: string,
  afterIndex: number,
): Promise<RelayEventWithIndex[]> {
  const client = await clientPromise;
  const db = client.db(DB_NAME);
  const docs = await db
    .collection<RelayEventDoc>(COLLECTIONS.events)
    .find({ gameId, index: { $gt: afterIndex } })
    .sort({ index: 1 })
    .toArray();
  return docs.map((doc) => ({ ...doc.event, index: doc.index }));
}

export async function pushInboxMessage(
  gameId: string,
  playerId: string,
  message: SecretMessage,
): Promise<boolean> {
  const client = await clientPromise;
  const db = client.db(DB_NAME);
  let result = await db.collection<InboxDoc>(COLLECTIONS.inbox).updateOne(
    { _id: `${gameId}:${playerId}` },
    {
      $push: { messages: message },
      $set: { updatedAt: Date.now() },
    },
  );
  if (result.matchedCount > 0) {
    return true;
  }

  // If inbox wasn't registered (serverless race), attempt to recover from JOIN event.
  const recovered = await ensureInboxFromJoinEvent(gameId, playerId);
  if (!recovered) {
    return false;
  }

  result = await db.collection<InboxDoc>(COLLECTIONS.inbox).updateOne(
    { _id: `${gameId}:${playerId}` },
    {
      $push: { messages: message },
      $set: { updatedAt: Date.now() },
    },
  );
  return result.matchedCount > 0;
}

export async function pullInboxMessages(
  gameId: string,
  playerId: string,
  token: string,
): Promise<SecretMessage[] | null> {
  const client = await clientPromise;
  const db = client.db(DB_NAME);
  let doc = await db.collection<InboxDoc>(COLLECTIONS.inbox).findOne({
    _id: `${gameId}:${playerId}`,
  });
  if (!doc) {
    await ensureInboxFromJoinEvent(gameId, playerId);
    doc = await db.collection<InboxDoc>(COLLECTIONS.inbox).findOne({
      _id: `${gameId}:${playerId}`,
    });
  }
  if (!doc || doc.token !== token) {
    return null;
  }
  const messages = [...doc.messages];
  await db.collection<InboxDoc>(COLLECTIONS.inbox).updateOne(
    { _id: `${gameId}:${playerId}` },
    {
      $set: { messages: [], updatedAt: Date.now() },
    },
  );
  return messages;
}
