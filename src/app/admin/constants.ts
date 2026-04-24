export type ClientStage =
  | "discovery"
  | "proposal"
  | "contract"
  | "onboarding"
  | "active"
  | "churned";

export type LinkType =
  | "proposal"
  | "contract"
  | "payment"
  | "kickoff"
  | "onboarding";

export type LinkStatus = "pending" | "viewed" | "completed";

export const LINK_TYPES: readonly LinkType[] = [
  "proposal",
  "contract",
  "payment",
  "kickoff",
  "onboarding",
];

export const CLIENT_STAGES: readonly ClientStage[] = [
  "discovery",
  "proposal",
  "contract",
  "onboarding",
  "active",
  "churned",
];

export const LINK_STATUSES: readonly LinkStatus[] = [
  "pending",
  "viewed",
  "completed",
];
