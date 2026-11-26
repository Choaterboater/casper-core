import { expect, test } from "bun:test";
import { SECRET_MARKER, scrubText } from "../src/secrets/scrub";
import { hideCommandSecrets, scrubPlainSecrets } from "../src/secrets/files";
import { isSecretFile } from "../src/secrets/names";

const PEM = [
  "-----BEGIN RSA PRIVATE KEY-----",
  "MIIEowIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF8PbnGy0AHB7MhgHcTz6sE2I2yPB",
  "aFDrBz0K1l0m9T2m8b7yVQ0m9Q0m9Q0m9Q0m9Q0m9Q0m9Q0m9Q0m9Q0m9Q0m9Q0m9Q0m",
  "-----END RSA PRIVATE KEY-----",
].join("\n");

test("a key=value line in a config is hidden and the key stays", () => {
  const result = scrubPlainSecrets("api_key=sk-not-a-real-key\nport=8080\n");
  expect(result.hidden).toBeGreaterThan(0);
  expect(result.text).toContain(`api_key=${SECRET_MARKER}`);
  expect(result.text).toContain("port=8080");
});

test("a PEM block is hidden", () => {
  const result = scrubText(PEM);
  expect(result.text).not.toContain("MIIEowIBAAKCAQEA0Z3VS5JJcds3xfn");
  expect(result.hidden).toBeGreaterThan(0);
});

test("scrubbing twice leaves the text unchanged", () => {
  const once = scrubText(PEM);
  const twice = scrubText(once.text);
  expect(twice.text).toBe(once.text);
  expect(twice.text).toContain(SECRET_MARKER);
  expect(twice.text).not.toContain("MIIEowIBAAKCAQEA0Z3VS5JJcds3xfn");
});

test("a marker written back is not hidden again", () => {
  const text = `password=${SECRET_MARKER}\n`;
  const again = scrubPlainSecrets(text);
  expect(again.text).toBe(text);
  expect(again.hidden).toBe(0);
});

test("plain secret assignment in command output is hidden", () => {
  const result = scrubPlainSecrets("export GITHUB_TOKEN=ghp_not_a_real_token\n");
  expect(result.text).toContain(SECRET_MARKER);
  expect(result.text).not.toContain("ghp_not_a_real_token");
});

test("a login header in a command is hidden", () => {
  const result = hideCommandSecrets("curl -H \"Authorization: Bearer abc.def.ghi\" https://example.test");
  expect(result.text).not.toContain("abc.def.ghi");
  expect(result.text).toContain(SECRET_MARKER);
});

test("secret file names are recognised", () => {
  expect(isSecretFile(".env")).toBe(true);
  expect(isSecretFile("config/prod.env")).toBe(true);
  expect(isSecretFile("id_rsa")).toBe(true);
  expect(isSecretFile("docker/config.json")).toBe(true);
  expect(isSecretFile("src/index.ts")).toBe(false);
});
