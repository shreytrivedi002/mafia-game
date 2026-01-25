import { MongoClient } from "mongodb";

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI is not set");
}

const uri = process.env.MONGODB_URI;
const options = {
  maxPoolSize: 5,
  serverSelectionTimeoutMS: 8000,
  connectTimeoutMS: 8000,
} as const;

declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
  // eslint-disable-next-line no-var
  var _mongoIndexesPromise: Promise<void> | undefined;
}

const globalWithMongo = globalThis as typeof globalThis & {
  _mongoClientPromise?: Promise<MongoClient>;
  _mongoIndexesPromise?: Promise<void>;
};

async function ensureIndexes(client: MongoClient) {
  const db = client.db("mafia");

  // Relay events lookup by game + cursor.
  await db.collection("events").createIndex({ gameId: 1, index: 1 });
  // JOIN recovery lookup.
  await db
    .collection("events")
    .createIndex({ gameId: 1, "event.type": 1, "event.payload.playerId": 1, createdAt: -1 });
  // Inbox lookup.
  await db.collection("inbox").createIndex({ gameId: 1, playerId: 1 });
  // Game state lookup is by _id already; this helps with potential cleanup/tools.
  await db.collection("games").createIndex({ updatedAt: -1 });
}

// In serverless environments (Netlify), you still want to reuse the client within a warm lambda.
// Always cache the promise on the global to avoid creating too many connections.
if (!globalWithMongo._mongoClientPromise) {
  const client = new MongoClient(uri, options);
  globalWithMongo._mongoClientPromise = client.connect();
}

const clientPromise = globalWithMongo._mongoClientPromise.then(async (client) => {
  if (!globalWithMongo._mongoIndexesPromise) {
    globalWithMongo._mongoIndexesPromise = ensureIndexes(client);
  }
  await globalWithMongo._mongoIndexesPromise;
  return client;
});

export default clientPromise;
