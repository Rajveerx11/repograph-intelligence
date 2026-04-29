import { greet } from "./util";
import express from "express";

// Application entrypoint for the greeting flow.
export function main() {
  return greet("RepoGraph");
}
