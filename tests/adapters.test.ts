import { describe, expect, it } from "vitest";
import { Agent37Client, cronPrompt, runnerCommand } from "@/adapters/agent37";
import { timeSaved } from "@/core/timeSaved";

describe("Agent37 client", () => {
  it("sends control-plane and instance calls with the documented auth headers", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: "ab12cd34ef", status: "running", url: "https://ab12cd34ef.agent37.app", template: "agent37-hermes", exit_code: 0, stdout: "", stderr: "" }), { status: 200 });
    }) as unknown as typeof fetch;
    const c = new Agent37Client("sk_test", "https://api.agent37.com", fake);

    await c.createInstance({ template: "agent37-hermes", name: "wf", env: { APP_URL: "https://x" } });
    await c.exec("ab12cd34ef", "node --version");
    await c.putFile("https://ab12cd34ef.agent37.app", "/home/node/workflow-agent/runner.mjs", "console.log(1)");
    await c.createCron("ab12cd34ef", { name: "close", prompt: cronPrompt("harbor-goods-close"), schedule: "0 7 1 * *", timezone: "America/Los_Angeles" });

    expect(calls[0].url).toBe("https://api.agent37.com/v1/instances");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer sk_test");
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({ template: "agent37-hermes", env: { APP_URL: "https://x" } });
    expect(calls[1].url).toBe("https://api.agent37.com/v1/instances/ab12cd34ef/exec");
    expect(calls[2].url).toContain("https://ab12cd34ef.agent37.app/v1/files/content?path=%2Fhome%2Fnode%2Fworkflow-agent%2Frunner.mjs");
    expect((calls[2].init.headers as Record<string, string>)["X-Agent37-Key"]).toBe("sk_test");
    expect(JSON.parse(calls[3].init.body as string).prompt).toContain(runnerCommand("harbor-goods-close", "scheduled"));
  });
});

describe("time saved", () => {
  it("is manual minutes minus decision minutes, with the formula shown", () => {
    const t = timeSaved({ minutesPerItem: 22, fixedMinutes: 60, minutesPerDecision: 2, perItemLabel: "min each", fixedLabel: "min fixed", source: "test" }, 7, 3, "statements");
    expect(t.manualMinutes).toBe(214);
    expect(t.humanMinutes).toBe(6);
    expect(t.eliminatedMinutes).toBe(208);
    expect(t.formula.at(-1)).toBe("Source: test");
  });
});
