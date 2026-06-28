import { type IngestInput } from "../marrow.js";

import { EmailConnector, type EmailConfig } from "./email.js";
import { FigmaConnector, type FigmaConfig } from "./figma.js";
import { GitHubIssuesConnector, type GitHubConfig } from "./github.js";
import { GranolaConnector, type GranolaConfig } from "./granola.js";
import { IntercomConnector, type IntercomConfig } from "./intercom.js";
import { JiraConnector, type JiraConfig } from "./jira.js";
import { LinearConnector, type LinearConfig } from "./linear.js";
import { NotionConnector, type NotionConfig } from "./notion.js";
import { OtterConnector, type OtterConfig } from "./otter.js";
import { SlackConnector, type SlackConfig } from "./slack.js";
import { TeamsConnector, type TeamsConfig } from "./teams.js";
import { ZoomConnector, type ZoomConfig } from "./zoom.js";

/** A connector fetches new evidence from an external product tool and returns
 *  drafts that can be ingested into Marrow. connectors never mutate Marrow;
 *  they are called by an ingestion scheduler. */
export interface Connector {
  readonly name: string;
  fetchSince(since: Date): Promise<IngestInput[]>;
}

export interface ConnectorConfig {
  enabled: boolean;
  since?: Date;
}

export {
  EmailConnector,
  type EmailConfig,
  FigmaConnector,
  type FigmaConfig,
  GitHubIssuesConnector,
  type GitHubConfig,
  GranolaConnector,
  type GranolaConfig,
  IntercomConnector,
  type IntercomConfig,
  JiraConnector,
  type JiraConfig,
  LinearConnector,
  type LinearConfig,
  NotionConnector,
  type NotionConfig,
  OtterConnector,
  type OtterConfig,
  SlackConnector,
  type SlackConfig,
  TeamsConnector,
  type TeamsConfig,
  ZoomConnector,
  type ZoomConfig,
};
