interface Elements {
  "#mode": HTMLSelectElement;
  "#prompt": HTMLTextAreaElement;
  "#chat-form": HTMLFormElement;
  "#memory-form": HTMLFormElement;
  "#skill-form": HTMLFormElement;
  "#send": HTMLButtonElement;
  "#stop": HTMLButtonElement;
  "#new-session": HTMLButtonElement;
  "#allow-writes": HTMLInputElement;
  "#allow-memory": HTMLInputElement;
  "#allow-skills": HTMLInputElement;
  "#allow-shell": HTMLInputElement;
  "#memory-content": HTMLTextAreaElement;
  "#skill-name": HTMLInputElement;
  "#skill-content": HTMLTextAreaElement;
  "#pi-provider": HTMLSelectElement;
  "#pi-model": HTMLInputElement;
  "#pi-api-key": HTMLInputElement;
  "#pi-clear-key": HTMLInputElement;
}
export function $<S extends keyof Elements>(selector: S): Elements[S];
export function $<T extends HTMLElement = HTMLElement>(selector: string): T;
export function $(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) throw new Error("Missing UI element: " + selector);
  return element;
}
