
import { sql, count } from 'drizzle-orm';
import { db } from './src/database/drizzle';
import { contractEvents } from './src/database/schema';

const sel = await db.select({ count: sql<number>`count(*)` }).from(contractEvents);
const a = sel[0] as any;
console.log('select count(*) value =', a?.count, 'typeof =', typeof a?.count);
const sel2 = await db.select({ eventName: contractEvents.eventName, count: sql<number>`count(*)` }).from(contractEvents).groupBy(contractEvents.eventName);
const b = sel2[0] as any;
console.log('groupBy count value =', b?.count, 'typeof =', typeof b?.count);
const sel3 = await db.select({ value: count() }).from(contractEvents);
const c = sel3[0] as any;
console.log('drizzle count() value =', c?.value, 'typeof =', typeof c?.value);
const sel4 = await db.select({ c: sql<number>`1234::BIGINT` });
const d = sel4[0] as any;
console.log('literal BIGINT =', d?.c, 'typeof =', typeof d?.c);
process.exit(0);
