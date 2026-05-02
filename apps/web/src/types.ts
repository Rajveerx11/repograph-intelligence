import type { RepoGraph } from "@repograph/shared-types";
import type { ACTIONS } from "./constants";

export type GraphFilter = "all" | "files" | "packages";

export type ActionId = typeof ACTIONS[number]["id"];

export type ActionResult = {
  title: string;
  message: string;
  graph?: RepoGraph;
  payload: unknown;
  formattedText?: string;
};

