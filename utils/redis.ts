import { createClient, RedisClientType, RedisDefaultModules } from "redis";

let redis: undefined | RedisClientType<RedisDefaultModules>;
const EX = 10 * 60 * 60;

async function redisClient() {
  const client = await createClient({
    username: "default",
    password: "p53gphqvoRln2rnytXqvIdgbBVJmrboH",
    socket: {
      host: "redis-15058.c264.ap-south-1-1.ec2.redns.redis-cloud.com",
      port: 15058,
    },
  })
    .on("error", (err) => console.log("Redis Client Error"))
    .on("connect", () => console.log("Connected redis successfully"))
    .connect();
  console.log("Redis init -----------------");
  return client;
}

function getKey(
  collectionName: string,
  query: any,
  page: number,
  limit: number
) {
  return `${collectionName}:${JSON.stringify(query)}:${page}:${limit}`;
}

redisClient().then((c: any) => {
  redis = c;
});

export { redis,getKey, EX };
