import path from "node:path";
import { analyzeRepository } from "./repository.js";
import { summarizeRepository } from "./summaries.js";

export async function analyzeRepositories(repoPaths, options = {}) {
  const repositories = [];
  for (const repoPath of repoPaths) {
    const graph = await analyzeRepository(repoPath, options);
    repositories.push({
      path: path.resolve(repoPath),
      graph,
      summary: summarizeRepository(graph)
    });
  }
  return summarizeWorkspace(repositories);
}

export function summarizeWorkspace(repositories) {
  const totals = repositories.reduce(
    (sum, repository) => {
      sum.files += repository.summary.metrics.files;
      sum.symbols += repository.summary.metrics.symbols;
      sum.internalDependencies += repository.summary.metrics.internalDependencies;
      sum.externalDependencies += repository.summary.metrics.externalDependencies;
      return sum;
    },
    { files: 0, symbols: 0, internalDependencies: 0, externalDependencies: 0 }
  );
  const sharedPackages = sharedExternalPackages(repositories);

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    repositoryCount: repositories.length,
    totals,
    repositories: repositories.map((repository) => ({
      path: repository.path,
      overview: repository.summary.overview,
      metrics: repository.summary.metrics,
      modules: repository.summary.architecture.modules.map((module) => module.name)
    })),
    sharedExternalPackages: sharedPackages
  };
}

function sharedExternalPackages(repositories) {
  const counts = new Map();
  for (const repository of repositories) {
    for (const packageName of new Set(repository.summary.externalPackages)) {
      counts.set(packageName, (counts.get(packageName) ?? 0) + 1);
    }
  }
  return Array.from(counts)
    .filter(([, count]) => count > 1)
    .map(([name, count]) => ({ name, repositories: count }))
    .sort((left, right) => right.repositories - left.repositories || left.name.localeCompare(right.name));
}
