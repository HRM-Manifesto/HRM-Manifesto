import { writeFile } from "node:fs/promises";
import path from "node:path";
import { reviewEmailFixtures } from "./review-email-fixtures.mjs";

const output = path.resolve(process.argv[2] || "hrm-review-email-fixtures.html");
const fixtures = reviewEmailFixtures().filter((fixture) => fixture.expectedEmail);
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>HRM review email fixtures</title></head><body style="margin:0">
${fixtures.map((fixture) => `<section data-fixture="${fixture.name}">${fixture.message.html}</section>`).join("\n")}
</body></html>`;
await writeFile(output, html, "utf8");
console.log(output);
