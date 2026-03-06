import { config } from "../config.js";

let pipelineFn: any = null;
let extractor: any = null;

async function getExtractor() {
  if (extractor) return extractor;

  if (!pipelineFn) {
    try {
      const transformers = await import("@huggingface/transformers");
      pipelineFn = transformers.pipeline;
    } catch {
      try {
        const transformers = await import("@xenova/transformers" as any);
        pipelineFn = transformers.pipeline;
      } catch {
        throw new Error(
          "Neither @huggingface/transformers nor @xenova/transformers is installed. " +
            "Install one to enable embeddings."
        );
      }
    }
  }

  extractor = await pipelineFn("feature-extraction", config.embeddingModel, {
    quantized: true,
  });

  console.error(`[embeddings] Model loaded: ${config.embeddingModel}`);
  return extractor;
}

export async function embed(text: string): Promise<number[]> {
  const ext = await getExtractor();
  const output = await ext(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}

export function vectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
