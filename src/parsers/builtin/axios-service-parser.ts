import { readFileSync, existsSync } from "fs";
import { join, basename } from "path";
import { glob } from "glob";
import type { ParserPlugin, ServiceResult } from "../types.js";

const CLASS_RE = /class\s+(\w+)\s+extends\s+(\w+)/;
const CONSTRUCTOR_URL_RE =
  /super\s*\(\s*(?:process\.env\.(\w+)|['"]([^'"]+)['"])/;
const METHOD_RE =
  /(?:public\s+)?(?:async\s+)?(\w+)\s*\([^)]*\)[^{]*\{/g;
const HTTP_CALL_RE =
  /this\.axios\.(get|post|put|patch|delete)\s*\(\s*[`'"](.*?)[`'"]/;
const RETURN_TYPE_RE = /\):\s*Promise<([^>]+)>/;

class AxiosServiceParser implements ParserPlugin {
  id = "axios-service";
  type = "service" as const;
  displayName = "Axios/ApiBase Service Parser";

  private servicesDir = "";
  private baseClass = "ApiBase";
  private projectRoot = "";

  async init(
    options: Record<string, unknown>,
    projectRoot: string
  ): Promise<void> {
    this.projectRoot = projectRoot;
    this.servicesDir =
      (options.servicesDir as string) ?? "support/services";
    this.baseClass = (options.baseClass as string) ?? "ApiBase";
  }

  async parse(service: string): Promise<ServiceResult> {
    const filePath = await this.findServiceFile(service);
    if (!filePath) throw new Error(`Service "${service}" not found`);

    const content = readFileSync(filePath, "utf-8");
    const classMatch = content.match(CLASS_RE);
    const name = classMatch?.[1] ?? basename(filePath, ".ts");

    const urlMatch = content.match(CONSTRUCTOR_URL_RE);
    const baseUrl = urlMatch?.[2] ?? urlMatch?.[1] ?? undefined;

    const methods = this.extractMethods(content);

    return {
      parserType: "service",
      parserId: this.id,
      name,
      baseUrl,
      methods,
    };
  }

  async discover(): Promise<string[]> {
    const dir = join(this.projectRoot, this.servicesDir);
    if (!existsSync(dir)) return [];

    const files = await glob(join(dir, "**/*.ts"), {
      ignore: ["**/node_modules/**", "**/*.spec.*", "**/*.test.*"],
    });

    const services: string[] = [];
    for (const f of files) {
      const content = readFileSync(f, "utf-8");
      if (content.includes(`extends ${this.baseClass}`)) {
        services.push(f.replace(this.projectRoot + "/", ""));
      }
    }
    return services;
  }

  private async findServiceFile(service: string): Promise<string | null> {
    const dir = join(this.projectRoot, this.servicesDir);
    if (!existsSync(dir)) return null;

    const files = await glob(join(dir, "**/*.ts"), {
      ignore: ["**/node_modules/**"],
    });

    const lower = service.toLowerCase();
    for (const f of files) {
      const name = basename(f, ".ts").toLowerCase();
      if (name === lower || name.includes(lower)) {
        const content = readFileSync(f, "utf-8");
        if (content.includes(`extends ${this.baseClass}`)) {
          return f;
        }
      }
    }

    for (const f of files) {
      const content = readFileSync(f, "utf-8");
      if (
        content.includes(`class ${service}`) ||
        content.toLowerCase().includes(`class ${lower}`)
      ) {
        return f;
      }
    }

    return null;
  }

  private extractMethods(
    content: string
  ): { name: string; verb: string; url: string; returnType?: string }[] {
    const methods: {
      name: string;
      verb: string;
      url: string;
      returnType?: string;
    }[] = [];

    const lines = content.split("\n");
    let currentMethod = "";
    let methodBlock = "";
    let braceDepth = 0;

    for (const line of lines) {
      const methodStart = line.match(
        /(?:public\s+)?(?:async\s+)?(\w+)\s*\([^)]*\)/
      );

      if (methodStart && !currentMethod && braceDepth === 0) {
        currentMethod = methodStart[1];
        methodBlock = line;
        braceDepth = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
        continue;
      }

      if (currentMethod) {
        methodBlock += "\n" + line;
        braceDepth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;

        if (braceDepth <= 0) {
          const httpMatch = methodBlock.match(HTTP_CALL_RE);
          if (httpMatch) {
            const returnMatch = methodBlock.match(RETURN_TYPE_RE);
            methods.push({
              name: currentMethod,
              verb: httpMatch[1].toUpperCase(),
              url: httpMatch[2],
              returnType: returnMatch?.[1],
            });
          }
          currentMethod = "";
          methodBlock = "";
          braceDepth = 0;
        }
      }
    }

    return methods;
  }
}

export default new AxiosServiceParser();
