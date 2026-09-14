import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
export const records = sqliteTable("records", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  date: text("date").notNull().default(""),
  amount: integer("amount").notNull().default(0),
  type: text("type").notNull().default(""),
  category: text("category").notNull().default(""),
  details: text("details").notNull().default(""),
  target: integer("target").notNull().default(0),
  phone: text("phone").notNull().default(""),
  address: text("address").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});
