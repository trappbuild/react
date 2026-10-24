import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

export function clearCookies() {
  if (typeof document === "undefined") return;
  for (const part of document.cookie.split("; ")) {
    const name = part.split("=")[0];
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
}

beforeEach(() => {
  clearCookies();
  if (typeof document === "undefined") return;
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  document.body.removeAttribute("style");
  delete window.dataLayer;
  delete window.gtag;
});

afterEach(() => {
  if (typeof document !== "undefined") cleanup();
});
