import type { ToolResult } from "../shared/types.ts";
export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options?.body && !(options.body instanceof Blob)
        ? { "Content-Type": "application/json" }
        : {}),
      ...options?.headers,
    },
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Request failed. Please try again.");
  return data;
}
export function post<T = ToolResult>(
  url: string,
  body: Record<string, unknown> = {},
) {
  return api<T>(url, { method: "POST", body: JSON.stringify(body) });
}
export function tool(name: string, input: Record<string, unknown>) {
  return post(`/api/tools/${name}`, input);
}
