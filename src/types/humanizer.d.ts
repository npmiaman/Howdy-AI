// brandonwise/humanizer (MIT) ships plain CommonJS without types.
declare module "humanizer" {
  export type HumanizerFinding = {
    patternId: number;
    patternName: string;
    category: string;
    weight: number;
    matchCount: number;
    matches: Array<{ match: string; suggestion?: string }>;
  };
  export function analyze(
    text: string,
    opts?: { verbose?: boolean },
  ): { score: number; findings: HumanizerFinding[] };
  export function score(text: string): number;
}

declare module "humanizer/src/humanizer.js" {
  export function autoFix(text: string): { text: string; fixes: string[] };
}
