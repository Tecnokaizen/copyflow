import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  OPENAI_DEFAULT_BASE_URL,
  resolveOpenAiBaseUrl,
} from "@/lib/ai/providers/base-url";

describe("OpenAI base URL allowlist", () => {
  it("defaults to the standard endpoint when unset or blank", () => {
    assert.equal(OPENAI_DEFAULT_BASE_URL, "https://api.openai.com/v1");
    assert.equal(resolveOpenAiBaseUrl(undefined), OPENAI_DEFAULT_BASE_URL);
    assert.equal(resolveOpenAiBaseUrl(""), OPENAI_DEFAULT_BASE_URL);
    assert.equal(resolveOpenAiBaseUrl("  "), OPENAI_DEFAULT_BASE_URL);
  });

  it("accepts only the standard and EU endpoints", () => {
    assert.equal(resolveOpenAiBaseUrl("https://api.openai.com/v1"), "https://api.openai.com/v1");
    assert.equal(resolveOpenAiBaseUrl("https://eu.api.openai.com/v1"), "https://eu.api.openai.com/v1");
    assert.equal(resolveOpenAiBaseUrl(" https://eu.api.openai.com/v1/ "), "https://eu.api.openai.com/v1");
  });

  it("rejects every other value", () => {
    for (const value of [
      "http://api.openai.com/v1",
      "https://api.openai.com",
      "https://api.openai.com/v2",
      "https://api.openai.com/v1/audio",
      "https://api.openai.com/v1//",
      "https://api.openai.com:443/v1",
      "https://API.openai.com/v1",
      "https://user:secret@api.openai.com/v1",
      "https://api.openai.com.attacker.example/v1",
      "https://us.api.openai.com/v1",
      "https://proxy.example.com/v1",
      "http://localhost:8080/v1",
      "api.openai.com/v1",
    ]) {
      assert.equal(resolveOpenAiBaseUrl(value), null, value);
    }
  });

  it("the OpenAI provider checks the allowlist when it is created", () => {
    const source = readFileSync(
      path.join(process.cwd(), "lib/ai/providers/openai.ts"),
      "utf8"
    );
    assert.match(source, /resolveOpenAiBaseUrl\(process\.env\.AI_PROVIDER_BASE_URL\)/);
    assert.equal(source.match(/process\.env\.AI_PROVIDER_BASE_URL/g)?.length, 1);
    for (const factory of [
      "createOpenAiTranscriptionProvider",
      "createOpenAiExtractionProvider",
    ]) {
      const body = source.slice(source.indexOf(`export function ${factory}`));
      assert.match(body, /^[^{]*\{\s*const baseUrl = requireBaseUrl\(\);/, factory);
    }
    assert.equal(source.match(/fetch\(`\$\{baseUrl\}\//g)?.length, 2);
  });
});
