import { describe, expect, it } from "vitest";
import { policyFor } from "../agent/approval.js";

const agent = (requireApproval: boolean, toolPolicies: Record<string, "allow" | "ask" | "block"> = {}) => ({
  requireApproval,
  toolPolicies,
});

describe("política de aprovação por ferramenta", () => {
  it("usa a regra da ferramenta, depois a do servidor MCP, depois o padrão do agente", () => {
    const a = agent(false, { calculator: "ask", "mcp__zapier__*": "block", mcp__zapier__find_email: "allow" });
    expect(policyFor(a, "calculator")).toBe("ask");
    expect(policyFor(a, "mcp__zapier__send_email")).toBe("block");
    expect(policyFor(a, "mcp__zapier__find_email")).toBe("allow");
    expect(policyFor(a, "current_time")).toBe("allow");
  });

  it("com aprovação humana ligada, o padrão é pedir aprovação, mas exceções liberam", () => {
    const a = agent(true, { current_time: "allow" });
    expect(policyFor(a, "calculator")).toBe("ask");
    expect(policyFor(a, "current_time")).toBe("allow");
  });
});
