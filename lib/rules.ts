import { api } from "@/lib/api";
import type { UserRule } from "./database.types";

export async function listRules(): Promise<UserRule[]> {
  const { rules } = await api.get<{ rules: UserRule[] }>("/rules");
  return rules;
}

/** The server turns the sentence into a validated rule. Throws ApiError `rule_not_understood` if it can't. */
export async function createRule(text: string): Promise<UserRule> {
  const { rule } = await api.post<{ rule: UserRule }>("/rules", { text });
  return rule;
}

export async function setRuleActive(id: string, isActive: boolean): Promise<UserRule> {
  const { rule } = await api.patch<{ rule: UserRule }>(`/rules/${id}`, { is_active: isActive });
  return rule;
}

export const deleteRule = (id: string) => api.delete(`/rules/${id}`);

/** Re-categorize existing saves with this rule. */
export const applyRule = (id: string) =>
  api.post<{ matched: number; updated: number }>(`/rules/${id}/apply`);
