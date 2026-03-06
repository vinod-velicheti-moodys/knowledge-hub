import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import type { ParserPlugin, StoreResult } from "../types.js";

const EXPORT_FUNCTION_RE =
  /(?:async\s+)?(?:function\s+)?(\w+)\s*\(/g;
const ACTION_DISPATCH_RE =
  /dispatch\s*\(\s*['"]([^'"]+)['"]/g;
const ACTION_COMMIT_RE = /commit\s*\(\s*['"]([^'"]+)['"]/g;
const SERVICE_IMPORT_RE =
  /import\s+\{?\s*(\w+Service\w*)\s*\}?\s+from\s+['"]([^'"]+)['"]/g;
const SERVICE_NEW_RE = /new\s+(\w+Service\w*)\s*\(/g;

class VuexStoreParser implements ParserPlugin {
  id = "vuex-store";
  type = "store" as const;
  displayName = "Vuex Store Parser";

  private storeDir = "";
  private projectRoot = "";

  async init(
    options: Record<string, unknown>,
    projectRoot: string
  ): Promise<void> {
    this.projectRoot = projectRoot;
    this.storeDir = (options.storeDir as string) ?? "store";
  }

  async parse(module: string): Promise<StoreResult> {
    const modulePath = join(this.projectRoot, this.storeDir, module);
    if (!existsSync(modulePath)) {
      throw new Error(`Store module not found: ${modulePath}`);
    }

    const actions = this.extractExports(join(modulePath, "actions.ts"));
    const mutations = this.extractExports(join(modulePath, "mutations.ts"));
    const getters = this.extractExports(join(modulePath, "getters.ts"));
    const services = this.extractServices(modulePath);
    const stateShape = this.extractStateShape(join(modulePath, "state.ts"));

    return {
      parserType: "store",
      parserId: this.id,
      name: module,
      actions,
      mutations,
      getters,
      services,
      stateShape,
    };
  }

  async discover(): Promise<string[]> {
    const fullPath = join(this.projectRoot, this.storeDir);
    if (!existsSync(fullPath)) return [];

    return readdirSync(fullPath, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  }

  private extractExports(filePath: string): string[] {
    if (!existsSync(filePath)) {
      const jsPath = filePath.replace(".ts", ".js");
      if (!existsSync(jsPath)) return [];
      return this.extractExportsFromContent(readFileSync(jsPath, "utf-8"));
    }
    return this.extractExportsFromContent(readFileSync(filePath, "utf-8"));
  }

  private extractExportsFromContent(content: string): string[] {
    const names: string[] = [];

    const exportBlockMatch = content.match(
      /export\s+(?:const|default)\s+(?:\w+\s*:\s*\w+[^=]*=\s*)?\{([\s\S]*)\}/
    );

    if (exportBlockMatch) {
      const block = exportBlockMatch[1];
      EXPORT_FUNCTION_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = EXPORT_FUNCTION_RE.exec(block))) {
        const name = match[1];
        if (
          name !== "dispatch" &&
          name !== "commit" &&
          name !== "state" &&
          name !== "getters" &&
          name !== "rootState" &&
          name !== "rootGetters"
        ) {
          names.push(name);
        }
      }
    }

    const namedExports = content.matchAll(
      /export\s+(?:async\s+)?function\s+(\w+)/g
    );
    for (const m of namedExports) {
      if (!names.includes(m[1])) names.push(m[1]);
    }

    return names;
  }

  private extractServices(modulePath: string): string[] {
    const services = new Set<string>();
    const files = ["actions.ts", "actions.js"];

    for (const file of files) {
      const filePath = join(modulePath, file);
      if (!existsSync(filePath)) continue;
      const content = readFileSync(filePath, "utf-8");

      let match: RegExpExecArray | null;

      SERVICE_IMPORT_RE.lastIndex = 0;
      while ((match = SERVICE_IMPORT_RE.exec(content))) {
        services.add(match[1]);
      }

      SERVICE_NEW_RE.lastIndex = 0;
      while ((match = SERVICE_NEW_RE.exec(content))) {
        services.add(match[1]);
      }
    }

    return [...services];
  }

  private extractStateShape(
    filePath: string
  ): Record<string, string> | undefined {
    if (!existsSync(filePath)) return undefined;
    const content = readFileSync(filePath, "utf-8");

    const shape: Record<string, string> = {};
    const stateMatch = content.match(/(?:export\s+default|=)\s*\(\s*\)\s*(?:=>)?\s*\({([\s\S]*?)\}/);
    if (!stateMatch) return undefined;

    const block = stateMatch[1];
    const propRe = /(\w+)\s*:\s*([^,\n]+)/g;
    let match: RegExpExecArray | null;
    while ((match = propRe.exec(block))) {
      const val = match[2].trim();
      if (val === "null") shape[match[1]] = "null";
      else if (val === "[]" || val.startsWith("[")) shape[match[1]] = "array";
      else if (val === "{}" || val.startsWith("{")) shape[match[1]] = "object";
      else if (val === "true" || val === "false") shape[match[1]] = "boolean";
      else if (val === "''" || val === '""') shape[match[1]] = "string";
      else if (!isNaN(Number(val))) shape[match[1]] = "number";
      else shape[match[1]] = val;
    }

    return Object.keys(shape).length > 0 ? shape : undefined;
  }
}

export default new VuexStoreParser();
