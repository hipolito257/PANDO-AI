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
  status:    text("status").notNull().default("active"), // "pending" | "active"
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
  country:         text("country").notNull().default("Mexico"),
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
  createdBy:       text("createdBy"),   // userId who added this company
  updatedBy:       text("updatedBy"),   // userId who last edited
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
  website:       text("website"),
  description:   text("description"),
  marketCapUsd:  doublePrecision("marketCapUsd"),
  evUsd:         doublePrecision("evUsd"),
  revenueUsd:    doublePrecision("revenueUsd"),
  ebitdaUsd:     doublePrecision("ebitdaUsd"),
  revenueGrowth: doublePrecision("revenueGrowth"),
  grossMargin:   doublePrecision("grossMargin"),
  ebitdaMargin:  doublePrecision("ebitdaMargin"),
  evRevenue:       doublePrecision("evRevenue"),
  evEbitda:        doublePrecision("evEbitda"),
  peRatio:         doublePrecision("peRatio"),
  operatingMargin: doublePrecision("operatingMargin"),
  netMargin:       doublePrecision("netMargin"),
  fcfUsd:          doublePrecision("fcfUsd"),
  psRatio:         doublePrecision("psRatio"),
  pbRatio:         doublePrecision("pbRatio"),
  roe:             doublePrecision("roe"),
  debtToEquity:    doublePrecision("debtToEquity"),
  beta:            doublePrecision("beta"),
  lastRefreshed:   text("lastRefreshed"),
  addedAt:         text("addedAt").default(sql`now()`),
});

// ── Comp Sets ─────────────────────────────────────────────────────────────────

export const compSets = pgTable("CompSet", {
  id:             text("id").primaryKey(),
  name:           text("name").notNull(),
  companyId:      text("companyId").references(() => companies.id, { onDelete: "set null" }),
  tickers:        text("tickers").notNull().default("[]"),
  notes:          text("notes"),
  aiDescriptions: text("aiDescriptions"),
  createdAt:      text("createdAt").default(sql`now()`),
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
  countries:    text("countries").notNull().default('["Mexico"]'),
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
  createdBy:    text("createdBy"),
  updatedBy:    text("updatedBy"),
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

// ── Firm Settings (singleton row, id = "default") ──────────────────────────────

export const firmSettings = pgTable("FirmSettings", {
  id:                     text("id").primaryKey(),
  investmentThesis:       text("investmentThesis"),
  investmentThesisFileName: text("investmentThesisFileName"),
  twoPagerTemplateUrl:    text("twoPagerTemplateUrl"),
  twoPagerTemplateName:   text("twoPagerTemplateName"),
  updatedAt:              text("updatedAt").default(sql`now()`),
  updatedBy:              text("updatedBy"),
});

// ── 2-Pager Section Structure (singleton row, id = "default") ─────────────────
// Admin-defined default outline for the "Company 2-Pager" document type.
// Each user can further edit this list per-build; only the admin default lives here.

export const twoPagerSectionsConfig = pgTable("TwoPagerSectionsConfig", {
  id:        text("id").primaryKey(),
  sections:  text("sections").notNull(), // JSON array of { id, title, guidance }
  updatedAt: text("updatedAt").default(sql`now()`),
  updatedBy: text("updatedBy"),
});

// ── Financial Models (LBO, and future model types) ─────────────────────────────
// A row is only created when a model is actually built (not on every AI-drafted
// assumption regeneration), so idle exploration doesn't pollute the saved list.
// Rebuilding an existing model updates the same row rather than creating a new one.

export const financialModels = pgTable("FinancialModel", {
  id:           text("id").primaryKey(),
  companyId:    text("companyId").references(() => companies.id, { onDelete: "cascade" }),
  companyName:  text("companyName"), // freeform fallback when no company is selected (target not yet tracked)
  modelType:    text("modelType").notNull().default("lbo"),
  name:         text("name").notNull(),
  status:       text("status").notNull().default("draft"), // "draft" | "built"
  assumptions:  text("assumptions").notNull(),              // JSON: the reviewed/edited assumptions object
  contextFiles: text("contextFiles").notNull().default("[]"), // JSON array of { name, url, type }
  workbookUrl:  text("workbookUrl"),
  workbookSize: integer("workbookSize"),
  createdAt:    text("createdAt").default(sql`now()`),
  updatedAt:    text("updatedAt").default(sql`now()`),
  createdBy:    text("createdBy"),
  updatedBy:    text("updatedBy"),
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
  createdBy:    text("createdBy"),
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

// ── Activity Log ──────────────────────────────────────────────────────────────

export const activityLog = pgTable("ActivityLog", {
  id:         text("id").primaryKey(),
  userId:     text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  userName:   text("userName").notNull(),
  action:     text("action").notNull(),   // "added_company" | "edited_company" | "added_mandate" | "uploaded_template" | "generated_document"
  entityType: text("entityType"),         // "company" | "mandate" | "template" | "document"
  entityId:   text("entityId"),
  entityName: text("entityName"),
  detail:     text("detail"),
  createdAt:  text("createdAt").default(sql`now()`),
});

// ── Relations ─────────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ one, many }) => ({
  settings: one(userSettings, { fields: [users.id], references: [userSettings.userId] }),
  activity: many(activityLog),
}));

export const activityLogRelations = relations(activityLog, ({ one }) => ({
  user: one(users, { fields: [activityLog.userId], references: [users.id] }),
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
  financialModels:  many(financialModels),
}));

export const notesRelations = relations(notes, ({ one }) => ({
  company: one(companies, { fields: [notes.companyId], references: [companies.id] }),
}));

export const financialModelsRelations = relations(financialModels, ({ one }) => ({
  company: one(companies, { fields: [financialModels.companyId], references: [companies.id] }),
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

// ── Cron Logs ─────────────────────────────────────────────────────────────────

export const cronLogs = pgTable("CronLog", {
  id:                  text("id").primaryKey(),
  ranAt:               text("ranAt").notNull(),
  durationMs:          integer("durationMs"),
  companiesScanned:    integer("companiesScanned").notNull().default(0),
  newsAdded:           integer("newsAdded").notNull().default(0),
  signalsAdded:        integer("signalsAdded").notNull().default(0),
  exitsDetected:       integer("exitsDetected").notNull().default(0),
  fundingUpdates:      integer("fundingUpdates").notNull().default(0),
  discovered:          integer("discovered").notNull().default(0),
  candidatesExtracted: integer("candidatesExtracted").notNull().default(0),
  filteredByThesis:    integer("filteredByThesis").notNull().default(0),
  status:              text("status").notNull().default("ok"),
  errorMsg:            text("errorMsg"),
});
