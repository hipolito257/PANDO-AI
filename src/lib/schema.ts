import {
  pgTable, text, doublePrecision, integer, boolean, timestamp
} from "drizzle-orm/pg-core";
import { sql, relations } from "drizzle-orm";

// ── Auth ──────────────────────────────────────────────────────────────────────

export const users = pgTable("User", {
  id:        text("id").primaryKey(),
  name:      text("name").notNull(),
  email:     text("email").notNull().unique(),
  password:  text("password").notNull(),
  role:      text("role").notNull().default("analyst"),
  avatarUrl: text("avatarUrl"),
  createdAt: text("createdAt").default(sql`now()`),
  updatedAt: text("updatedAt").default(sql`now()`),
});

// ── User Settings ──────────────────────────────────────────────────────────────

export const userSettings = pgTable("UserSettings", {
  id:              text("id").primaryKey(),
  userId:          text("userId").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  anthropicApiKey: text("anthropicApiKey"),
  createdAt:       text("createdAt").default(sql`now()`),
  updatedAt:       text("updatedAt").default(sql`now()`),
});

// ── Companies ─────────────────────────────────────────────────────────────────

export const companies = pgTable("Company", {
  id:              text("id").primaryKey(),
  name:            text("name").notNull(),
  slug:            text("slug").notNull().unique(),
  sector:          text("sector"),
  subsector:       text("subsector"),
  country:         text("country").notNull().default("México"),
  city:            text("city"),
  stage:           text("stage"),
  website:         text("website"),
  linkedinUrl:     text("linkedinUrl"),
  description:     text("description"),
  revenueUsd:      doublePrecision("revenueUsd"),
  revenueGrowth:   doublePrecision("revenueGrowth"),
  ebitdaUsd:       doublePrecision("ebitdaUsd"),
  ebitdaMargin:    doublePrecision("ebitdaMargin"),
  employees:       integer("employees"),
  employeeGrowth:  doublePrecision("employeeGrowth"),
  totalFunding:    doublePrecision("totalFunding"),
  lastFundingAmt:  doublePrecision("lastFundingAmt"),
  lastFundingDate: text("lastFundingDate"),
  fundingStage:    text("fundingStage"),
  score:           doublePrecision("score").notNull().default(0),
  confidence:      doublePrecision("confidence").notNull().default(0.5),
  status:          text("status").notNull().default("monitoring"),
  addedAt:         text("addedAt").default(sql`now()`),
  updatedAt:       text("updatedAt").default(sql`now()`),
});

export const financialSnapshots = pgTable("FinancialSnapshot", {
  id:         text("id").primaryKey(),
  companyId:  text("companyId").notNull().references(() => companies.id, { onDelete: "cascade" }),
  year:       integer("year").notNull(),
  quarter:    integer("quarter").default(0),
  revenueUsd: doublePrecision("revenueUsd"),
  ebitdaUsd:  doublePrecision("ebitdaUsd"),
  employees:  integer("employees"),
});

export const founders = pgTable("Founder", {
  id:          text("id").primaryKey(),
  companyId:   text("companyId").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name:        text("name").notNull(),
  title:       text("title"),
  linkedinUrl: text("linkedinUrl"),
  bio:         text("bio"),
});

export const signals = pgTable("Signal", {
  id:        text("id").primaryKey(),
  companyId: text("companyId").notNull().references(() => companies.id, { onDelete: "cascade" }),
  type:      text("type").notNull(),
  title:     text("title").notNull(),
  detail:    text("detail"),
  severity:  text("severity").notNull().default("medium"),
  isRead:    boolean("isRead").notNull().default(false),
  date:      text("date").default(sql`now()`),
});

export const companyTags = pgTable("CompanyTag", {
  id:        text("id").primaryKey(),
  companyId: text("companyId").notNull().references(() => companies.id, { onDelete: "cascade" }),
  tag:       text("tag").notNull(),
});

export const newsItems = pgTable("NewsItem", {
  id:        text("id").primaryKey(),
  companyId: text("companyId").notNull().references(() => companies.id, { onDelete: "cascade" }),
  title:     text("title").notNull(),
  source:    text("source"),
  url:       text("url"),
  summary:   text("summary"),
  date:      text("date").notNull(),
  sentiment: text("sentiment"),
});

// ── Public Comparables ────────────────────────────────────────────────────────

export const publicComps = pgTable("PublicComp", {
  id:            text("id").primaryKey(),
  ticker:        text("ticker").notNull().unique(),
  name:          text("name").notNull(),
  sector:        text("sector"),
  exchange:      text("exchange"),
  description:   text("description"),
  marketCapUsd:  doublePrecision("marketCapUsd"),
  evUsd:         doublePrecision("evUsd"),
  revenueUsd:    doublePrecision("revenueUsd"),
  ebitdaUsd:     doublePrecision("ebitdaUsd"),
  revenueGrowth: doublePrecision("revenueGrowth"),
  grossMargin:   doublePrecision("grossMargin"),
  ebitdaMargin:  doublePrecision("ebitdaMargin"),
  evRevenue:     doublePrecision("evRevenue"),
  evEbitda:      doublePrecision("evEbitda"),
  peRatio:       doublePrecision("peRatio"),
  lastRefreshed: text("lastRefreshed"),
  addedAt:       text("addedAt").default(sql`now()`),
});

// ── Comp Sets ─────────────────────────────────────────────────────────────────

export const compSets = pgTable("CompSet", {
  id:        text("id").primaryKey(),
  name:      text("name").notNull(),
  companyId: text("companyId").references(() => companies.id, { onDelete: "set null" }),
  tickers:   text("tickers").notNull().default("[]"),
  notes:     text("notes"),
  createdAt: text("createdAt").default(sql`now()`),
});

// ── Notes ─────────────────────────────────────────────────────────────────────

export const notes = pgTable("Note", {
  id:         text("id").primaryKey(),
  companyId:  text("companyId").notNull().references(() => companies.id, { onDelete: "cascade" }),
  content:    text("content").notNull(),
  authorName: text("authorName").notNull().default("Equipo PANDO"),
  createdAt:  text("createdAt").default(sql`now()`),
});

// ── Mandates ──────────────────────────────────────────────────────────────────

export const mandates = pgTable("Mandate", {
  id:           text("id").primaryKey(),
  name:         text("name").notNull(),
  description:  text("description"),
  sectors:      text("sectors").notNull().default("[]"),
  countries:    text("countries").notNull().default('["México"]'),
  stages:       text("stages").notNull().default("[]"),
  minRevenue:   doublePrecision("minRevenue"),
  maxRevenue:   doublePrecision("maxRevenue"),
  minEbitda:    doublePrecision("minEbitda"),
  minEmployees: integer("minEmployees"),
  maxEmployees: integer("maxEmployees"),
  thesis:       text("thesis"),
  isActive:     boolean("isActive").notNull().default(true),
  createdAt:    text("createdAt").default(sql`now()`),
  updatedAt:    text("updatedAt").default(sql`now()`),
});

export const mandateMatches = pgTable("MandateMatch", {
  id:        text("id").primaryKey(),
  companyId: text("companyId").notNull().references(() => companies.id, { onDelete: "cascade" }),
  mandateId: text("mandateId").notNull().references(() => mandates.id, { onDelete: "cascade" }),
  score:     doublePrecision("score").notNull().default(0),
  rationale: text("rationale"),
  tier:      text("tier").notNull().default("candidate"),
  updatedAt: text("updatedAt").default(sql`now()`),
});

// ── Document Templates ────────────────────────────────────────────────────────

export const documentTemplates = pgTable("DocumentTemplate", {
  id:           text("id").primaryKey(),
  name:         text("name").notNull(),
  type:         text("type").notNull(),           // "pptx" | "docx" | "xlsx"
  description:  text("description"),
  filePath:     text("filePath").notNull(),        // Vercel Blob URL in production
  fileSize:     integer("fileSize"),
  placeholders: text("placeholders").notNull().default("[]"),
  createdAt:    text("createdAt").default(sql`now()`),
});

// ── Data Sources ──────────────────────────────────────────────────────────────

export const dataSources = pgTable("DataSource", {
  id:             text("id").primaryKey(),
  name:           text("name").notNull().unique(),
  displayName:    text("displayName").notNull(),
  category:       text("category").notNull(),
  isSubscribed:   boolean("isSubscribed").notNull().default(false),
  isEnabled:      boolean("isEnabled").notNull().default(false),
  description:    text("description"),
  website:        text("website"),
  logoColor:      text("logoColor"),
  costType:       text("costType").notNull().default("paid"),
  requiresApiKey: boolean("requiresApiKey").notNull().default(true),
  accessHint:     text("accessHint"),
  apiKey:         text("apiKey"),
  updatedAt:      text("updatedAt").default(sql`now()`),
});

// ── Relations ─────────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ one }) => ({
  settings: one(userSettings, { fields: [users.id], references: [userSettings.userId] }),
}));

export const userSettingsRelations = relations(userSettings, ({ one }) => ({
  user: one(users, { fields: [userSettings.userId], references: [users.id] }),
}));

export const companiesRelations = relations(companies, ({ many }) => ({
  signals:          many(signals),
  tags:             many(companyTags),
  mandateMatches:   many(mandateMatches),
  newsItems:        many(newsItems),
  founders:         many(founders),
  financialHistory: many(financialSnapshots),
  notes:            many(notes),
}));

export const notesRelations = relations(notes, ({ one }) => ({
  company: one(companies, { fields: [notes.companyId], references: [companies.id] }),
}));

export const signalsRelations = relations(signals, ({ one }) => ({
  company: one(companies, { fields: [signals.companyId], references: [companies.id] }),
}));

export const companyTagsRelations = relations(companyTags, ({ one }) => ({
  company: one(companies, { fields: [companyTags.companyId], references: [companies.id] }),
}));

export const newsItemsRelations = relations(newsItems, ({ one }) => ({
  company: one(companies, { fields: [newsItems.companyId], references: [companies.id] }),
}));

export const foundersRelations = relations(founders, ({ one }) => ({
  company: one(companies, { fields: [founders.companyId], references: [companies.id] }),
}));

export const financialSnapshotsRelations = relations(financialSnapshots, ({ one }) => ({
  company: one(companies, { fields: [financialSnapshots.companyId], references: [companies.id] }),
}));

export const mandatesRelations = relations(mandates, ({ many }) => ({
  matches: many(mandateMatches),
}));

export const mandateMatchesRelations = relations(mandateMatches, ({ one }) => ({
  company: one(companies, { fields: [mandateMatches.companyId], references: [companies.id] }),
  mandate: one(mandates,  { fields: [mandateMatches.mandateId], references: [mandates.id] }),
}));

export const compSetsRelations = relations(compSets, ({ one }) => ({
  company: one(companies, { fields: [compSets.companyId], references: [companies.id] }),
}));
