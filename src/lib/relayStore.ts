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
  const existing = await db.collection<RelayEventDoc>(COLLECTIONS.events).findOne({
    _id: eventKey,
  });
  if (existing) {
    return null;
  }

  // Get or create game doc and atomically increment event index
  const gameDoc = await db.collection<RelayGameDoc>(COLLECTIONS.games).findOne({ _id: gameId });
  let index: number;
  if (!gameDoc) {
    index = 1;
    await db.collection<RelayGameDoc>(COLLECTIONS.games).insertOne({
      _id: gameId,
      nextEventIndex: 2,
      updatedAt: Date.now(),
    });
  } else {
    const result = await db.collection<RelayGameDoc>(COLLECTIONS.games).findOneAndUpdate(
      { _id: gameId },
      { $inc: { nextEventIndex: 1 }, $set: { updatedAt: Date.now() } },
      { returnDocument: "after" },
    );
    index = result?.nextEventIndex ?? gameDoc.nextEventIndex;
  }

  await db.collection<RelayEventDoc>(COLLECTIONS.events).insertOne({
    _id: eventKey,
    gameId,
    eventId: event.id,
    event,
    index,
    createdAt: Date.now(),
  });

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
  const result = await db.collection<InboxDoc>(COLLECTIONS.inbox).updateOne(
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
  const doc = await db.collection<InboxDoc>(COLLECTIONS.inbox).findOne({
    _id: `${gameId}:${playerId}`,
  });
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
