import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const scope = "@notion-kanban-blog/";
const expectedPackages = [
  "auth",
  "domain",
  "github",
  "notion",
  "publisher",
];
const allowedInternalDependencies = {
  auth: new Set(["domain"]),
  domain: new Set(),
  github: new Set(["domain"]),
  notion: new Set(["domain"]),
  publisher: new Set(["domain"]),
};

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return sourceFiles(entryPath);
      }
      return entry.name.endsWith(".ts") ? [entryPath] : [];
    }),
  );
  return files.flat();
}

export async function checkPackageBoundaries(rootDirectory = process.cwd()) {
  const errors = [];

  for (const packageName of expectedPackages) {
    const packageDirectory = path.join(rootDirectory, "packages", packageName);
    const manifest = await readJson(path.join(packageDirectory, "package.json"));
    const expectedName = `${scope}${packageName}`;

    if (manifest.name !== expectedName) {
      errors.push(`${packageName}: package name must be ${expectedName}`);
    }

    const declaredDependencies = Object.keys(manifest.dependencies ?? {});
    for (const dependency of declaredDependencies) {
      if (!dependency.startsWith(scope)) {
        continue;
      }

      const dependencyName = dependency.slice(scope.length);
      if (!allowedInternalDependencies[packageName].has(dependencyName)) {
        errors.push(`${packageName}: dependency on ${dependencyName} is forbidden`);
      }
    }

    for (const filePath of await sourceFiles(path.join(packageDirectory, "src"))) {
      const source = await readFile(filePath, "utf8");
      const imports = source.matchAll(
        /(?:from\s+|import\s*\()["'](@notion-kanban-blog\/[^"']+)["']/g,
      );

      for (const match of imports) {
        const dependency = match[1];
        const dependencyName = dependency.slice(scope.length);
        if (!declaredDependencies.includes(dependency)) {
          errors.push(
            `${path.relative(rootDirectory, filePath)}: ${dependency} is not declared`,
          );
        } else if (!allowedInternalDependencies[packageName].has(dependencyName)) {
          errors.push(
            `${path.relative(rootDirectory, filePath)}: import of ${dependency} is forbidden`,
          );
        }
      }
    }
  }

  return errors;
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  const errors = await checkPackageBoundaries();
  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else {
    console.info("Package boundaries are valid.");
  }
}
