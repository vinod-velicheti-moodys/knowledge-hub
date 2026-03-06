import { existsSync, readdirSync, statSync } from "fs";
import { join, basename, relative } from "path";
import type { ParserPlugin, RouteResult } from "../types.js";

class Nuxt2RouteParser implements ParserPlugin {
  id = "nuxt2-route";
  type = "route" as const;
  displayName = "Nuxt 2 Route Parser";

  private pagesDir = "";
  private projectRoot = "";

  async init(
    options: Record<string, unknown>,
    projectRoot: string
  ): Promise<void> {
    this.projectRoot = projectRoot;
    this.pagesDir = (options.pagesDir as string) ?? "pages";
  }

  async parse(): Promise<RouteResult> {
    const fullPath = join(this.projectRoot, this.pagesDir);
    if (!existsSync(fullPath)) {
      throw new Error(`Pages directory not found: ${fullPath}`);
    }

    const routes = this.scanDirectory(fullPath, "/");

    return {
      parserType: "route",
      parserId: this.id,
      routes,
    };
  }

  async discover(): Promise<string[]> {
    return [this.pagesDir];
  }

  private scanDirectory(
    dir: string,
    routePrefix: string
  ): { path: string; component: string; name?: string }[] {
    const routes: { path: string; component: string; name?: string }[] = [];

    if (!existsSync(dir)) return routes;
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        const dirName = entry.name;
        const routeSegment = dirName.startsWith("_")
          ? `:${dirName.slice(1)}`
          : dirName;

        const indexFile = this.findIndexFile(fullPath);
        if (indexFile) {
          const component = relative(this.projectRoot, indexFile);
          routes.push({
            path: `${routePrefix}${routeSegment}`,
            component,
            name: this.buildRouteName(routePrefix, routeSegment),
          });
        }

        routes.push(
          ...this.scanDirectory(
            fullPath,
            `${routePrefix}${routeSegment}/`
          )
        );
      } else if (
        entry.isFile() &&
        entry.name.endsWith(".vue") &&
        entry.name !== "index.vue"
      ) {
        const fileName = basename(entry.name, ".vue");
        const routeSegment = fileName.startsWith("_")
          ? `:${fileName.slice(1)}`
          : fileName;

        const component = relative(this.projectRoot, fullPath);
        routes.push({
          path: `${routePrefix}${routeSegment}`,
          component,
          name: this.buildRouteName(routePrefix, routeSegment),
        });
      } else if (entry.isFile() && entry.name === "index.vue") {
        if (routePrefix === "/") {
          routes.push({
            path: "/",
            component: relative(this.projectRoot, fullPath),
            name: "index",
          });
        }
      }
    }

    return routes;
  }

  private findIndexFile(dir: string): string | null {
    for (const name of ["index.vue", "index.js", "index.ts"]) {
      const p = join(dir, name);
      if (existsSync(p)) return p;
    }
    return null;
  }

  private buildRouteName(prefix: string, segment: string): string {
    const parts = prefix
      .split("/")
      .filter(Boolean)
      .map((p) => p.replace(/^:/, ""));
    parts.push(segment.replace(/^:/, ""));
    return parts.join("-");
  }
}

export default new Nuxt2RouteParser();
